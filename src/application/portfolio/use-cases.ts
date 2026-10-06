import { type Market, parseMarket } from '../../domain/market-data/market.js';
import type { AccountSummary } from '../../domain/portfolio/account-summary.js';
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityPage,
} from '../../domain/portfolio/activity.js';
import {
  type ClosedTrade,
  type InstrumentTradingStats,
  type JournalPage,
  journalRange,
  type SellJournalEntry,
  type TradingMetrics,
} from '../../domain/portfolio/journal.js';
import { type Order, parseOrderStatusFilter } from '../../domain/portfolio/order.js';
import {
  type AllocationSummary,
  computeAllocation,
  type Position,
  positionWeight,
} from '../../domain/portfolio/position.js';
import type { JournalQuery, PortfolioRepository } from '../../domain/portfolio/repository.js';
import {
  parseReturnsInterval,
  type RealizedReturns,
  type ReturnsInterval,
  type ReturnsPoint,
  type ReturnsSeriesSummary,
  summarizeReturnsSeries,
} from '../../domain/portfolio/returns.js';
import type { SellableQuantity } from '../../domain/portfolio/sellable-quantity.js';
import { ValidationError } from '../../domain/shared-kernel/errors.js';
import { Ticker } from '../../domain/shared-kernel/ticker.js';
import type { InstrumentResolver } from '../market-data/instrument-resolver.js';
import type { Clock } from '../ports/clock.js';

/**
 * Portfolio use cases. All of them are read-only (ADR 0006): nothing here places, modifies or cancels orders or
 * moves funds.
 */
export interface PortfolioDependencies {
  repository: PortfolioRepository;
  resolver: InstrumentResolver;
  clock: Clock;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(Math.max(n, min), max);
}

export class GetAccountSummary {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: { market?: string }): Promise<AccountSummary & { market: Market; positions: number }> {
    const market = parseMarket(input.market);
    const { summary, positions } = await this.deps.repository.getAccount(market);
    return { market, ...summary, positions: positions.length };
  }
}

export const POSITION_SORT_FIELDS = [
  'marketValue',
  'unrealizedPnl',
  'unrealizedPnlPercent',
  'costValue',
  'ticker',
] as const;
export type PositionSortField = (typeof POSITION_SORT_FIELDS)[number];

export interface PositionsResult {
  market: Market;
  currency: AccountSummary['currency'];
  portfolioValue: number;
  totalReturn: number | null;
  totalReturnPercent: number | null;
  positions: Array<Position & { weightPercent: number }>;
  allocation: AllocationSummary;
}

export class GetPositions {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: {
    market?: string;
    sortBy?: PositionSortField;
    order?: 'asc' | 'desc';
  }): Promise<PositionsResult> {
    const market = parseMarket(input.market);
    const { summary, positions } = await this.deps.repository.getAccount(market);
    const allocation = computeAllocation(positions, summary.portfolioValue);
    const sortBy = input.sortBy ?? 'marketValue';
    const direction = input.order === 'asc' ? 1 : -1;
    const rows = positions.map((p) => ({
      ...p,
      weightPercent: positionWeight(p.marketValue, allocation.basis),
    }));
    rows.sort((a, b) => {
      if (sortBy === 'ticker') return a.ticker.value.localeCompare(b.ticker.value) * direction;
      const x = a[sortBy];
      const y = b[sortBy];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction;
    });
    return {
      market,
      currency: summary.currency,
      portfolioValue: summary.portfolioValue,
      totalReturn: summary.totalReturn,
      totalReturnPercent: summary.totalReturnPercent,
      positions: rows,
      allocation,
    };
  }
}

export class GetPosition {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: { symbol: string; market?: string; includeSellable?: boolean }): Promise<{
    ticker: string;
    held: boolean;
    position: Position | null;
    sellable: SellableQuantity | null;
  }> {
    const market = parseMarket(input.market);
    const instrument = await this.deps.resolver.resolve(input.symbol, market);
    const position = await this.deps.repository.getPosition(instrument.id, market);
    const held = position !== null && position.quantity > 0;
    const sellable =
      held && input.includeSellable !== false
        ? await this.deps.repository.getSellableQuantity(instrument.id, market)
        : null;
    return { ticker: instrument.ticker.value, held, position, sellable };
  }
}

export class ListOrders {
  /** ThndrX pages orders by 10 or 20; we never ask for more per request. */
  static readonly PAGE_SIZE = 20;

  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: {
    market?: string;
    status?: string;
    symbol?: string;
    limit?: number;
    cursor?: string;
    oldestFirst?: boolean;
  }): Promise<{ market: Market; status: string; orders: Order[]; nextCursor: string | null }> {
    const market = parseMarket(input.market);
    const status = parseOrderStatusFilter(input.status);
    const limit = clamp(input.limit, 20, 1, 100);
    const instrumentId = input.symbol
      ? (await this.deps.resolver.resolve(input.symbol, market)).id
      : undefined;
    const orders: Order[] = [];
    let cursor: string | null = input.cursor || null;
    let first = true;
    // Never over-fetch: each request asks for at most what is still missing, so `nextCursor` stays exact.
    while (orders.length < limit && (first || cursor !== null)) {
      const page = await this.deps.repository.listOrders({
        market,
        status,
        limit: Math.min(limit - orders.length, ListOrders.PAGE_SIZE),
        sortOrder: input.oldestFirst ? 'ASC' : 'DESC',
        ...(cursor ? { cursor } : {}),
        ...(instrumentId ? { instrumentId } : {}),
      });
      first = false;
      orders.push(...page.orders);
      cursor = page.nextCursor;
      if (page.orders.length === 0) break;
    }
    return { market, status, orders, nextCursor: cursor };
  }
}

export class GetRealizedReturns {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: { market?: string; interval?: string }): Promise<{
    market: Market;
    current: RealizedReturns;
    interval: ReturnsInterval;
    series: ReturnsPoint[];
    seriesSummary: ReturnsSeriesSummary;
  }> {
    const market = parseMarket(input.market);
    const interval = parseReturnsInterval(input.interval);
    const [current, series] = await Promise.all([
      this.deps.repository.getRealizedReturns(market),
      this.deps.repository.getReturnsChart(interval, market),
    ]);
    const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
    return { market, current, interval, series: sorted, seriesSummary: summarizeReturnsSeries(sorted) };
  }
}

export interface JournalInput {
  market?: string;
  symbol?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

function journalQuery(input: JournalInput, clock: Clock): JournalQuery {
  const range = journalRange(input.from, input.to, clock.now());
  return {
    market: parseMarket(input.market),
    page: clamp(input.page, 1, 1, 10_000),
    limit: clamp(input.limit, 20, 1, 100),
    ...range,
    ...(input.symbol ? { ticker: Ticker.of(input.symbol).value } : {}),
  };
}

/** Closed round-trip trades from the trading journal. */
export class GetClosedTrades {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: JournalInput): Promise<JournalPage<ClosedTrade>> {
    return this.deps.repository.getClosedTrades(journalQuery(input, this.deps.clock));
  }
}

/** Individual (possibly partial) sells with their realized P/L. */
export class GetSellJournal {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: JournalInput): Promise<JournalPage<SellJournalEntry>> {
    return this.deps.repository.getSellJournal(journalQuery(input, this.deps.clock));
  }
}

export class GetTradingMetrics {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: { from?: Date; to?: Date; market?: string }): Promise<TradingMetrics> {
    const range = journalRange(input.from, input.to, this.deps.clock.now());
    const market = parseMarket(input.market);
    const metrics = await this.deps.repository.getTradingMetrics(range);
    // Thndr keys per-symbol stats by asset id only: resolve tickers best-effort (cached by the resolver).
    const perInstrument = await Promise.all(
      metrics.perInstrument.map(async (stats): Promise<InstrumentTradingStats> => {
        if (stats.ticker || !stats.instrumentId) return stats;
        const ticker = await this.deps.resolver
          .resolve(stats.instrumentId.value, market)
          .then((instrument) => instrument.ticker)
          .catch(() => null);
        return Object.freeze({ ...stats, ticker });
      }),
    );
    perInstrument.sort((a, b) => (b.totalReturn ?? 0) - (a.totalReturn ?? 0));
    return Object.freeze({ overall: metrics.overall, perInstrument });
  }
}

export class ListAccountActivity {
  constructor(private readonly deps: PortfolioDependencies) {}

  async execute(input: {
    market?: string;
    page?: number;
    pageSize?: number;
    category?: string;
  }): Promise<ActivityPage & { market: Market }> {
    const market = parseMarket(input.market);
    const category = parseActivityCategory(input.category);
    const page = clamp(input.page, 1, 1, 10_000);
    const result = await this.deps.repository.listActivities(market, page, clamp(input.pageSize, 20, 1, 100));
    return {
      market,
      ...result,
      // Thndr has no server-side filter we can rely on: filter the fetched page.
      activities: category ? result.activities.filter((a) => a.category === category) : result.activities,
    };
  }
}

function parseActivityCategory(raw: string | undefined): ActivityCategory | null {
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'all') return null;
  const value = raw.trim().toUpperCase();
  if (!(ACTIVITY_CATEGORIES as readonly string[]).includes(value)) {
    throw new ValidationError(
      `Unsupported activity category "${raw}". Use one of: ${ACTIVITY_CATEGORIES.join(', ')}`,
    );
  }
  return value as ActivityCategory;
}
