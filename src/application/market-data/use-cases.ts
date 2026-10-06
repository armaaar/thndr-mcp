import type { Candle, CandleResolution } from '../../domain/market-data/candle.js';
import { historyWindow, RESOLUTION_MS } from '../../domain/market-data/candle.js';
import type { Instrument, Quote } from '../../domain/market-data/instrument.js';
import { relativeVolume } from '../../domain/market-data/instrument.js';
import { type Market, parseMarket } from '../../domain/market-data/market.js';
import { type OrderBook, spread, type TapeTrade } from '../../domain/market-data/order-book.js';
import type { MarketDataRepository } from '../../domain/market-data/repository.js';
import { ValidationError } from '../../domain/shared-kernel/errors.js';
import { assertNonEmpty } from '../../domain/shared-kernel/guards.js';
import type { Clock } from '../ports/clock.js';
import type { InstrumentResolver } from './instrument-resolver.js';
import type { MarketQuotesCache } from './quote-cache.js';

export interface MarketDataDependencies {
  repository: MarketDataRepository;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
  clock: Clock;
}

export class SearchInstruments {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: { query: string; market?: string; limit?: number }): Promise<Instrument[]> {
    const query = assertNonEmpty(input.query, 'Search query');
    const results = await this.deps.repository.searchInstruments(query, parseMarket(input.market));
    for (const instrument of results) this.deps.resolver.remember(instrument);
    return results.slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
  }
}

export class GetInstrumentDetails {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: { symbol: string; market?: string }): Promise<Instrument> {
    const resolved = await this.deps.resolver.resolve(input.symbol, parseMarket(input.market));
    return this.deps.repository.getInstrument(resolved.id);
  }
}

export class GetPriceSnapshot {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: {
    symbols: readonly string[];
    market?: string;
  }): Promise<{ quotes: Quote[]; missing: string[] }> {
    if (input.symbols.length === 0) throw new ValidationError('Provide at least one symbol');
    if (input.symbols.length > 50) throw new ValidationError('At most 50 symbols per request');
    const market = parseMarket(input.market);
    const [instruments, all] = await Promise.all([
      this.deps.resolver.resolveMany(input.symbols, market),
      this.deps.quotes.get(market),
    ]);
    const byId = new Map(all.map((q) => [q.instrumentId.value, q]));
    const quotes: Quote[] = [];
    const missing: string[] = [];
    for (const instrument of instruments) {
      const quote = byId.get(instrument.id.value);
      if (quote) quotes.push(quote);
      else missing.push(instrument.ticker.value);
    }
    return { quotes, missing };
  }
}

export interface PriceHistoryResult {
  ticker: string;
  resolution: CandleResolution;
  from: string;
  to: string;
  candles: Candle[];
}

export class GetPriceHistory {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: {
    symbol: string;
    market?: string;
    resolution: CandleResolution;
    from?: Date;
    to?: Date;
    bars?: number;
  }): Promise<PriceHistoryResult> {
    const now = this.deps.clock.now();
    const to = input.to ?? now;
    const bars = Math.min(Math.max(input.bars ?? 100, 1), 2000);
    // Markets are closed most of the time; over-fetch the window for intraday bars, then trim to `bars`.
    const span =
      RESOLUTION_MS[input.resolution] *
      bars *
      (input.resolution.endsWith('min') || input.resolution === '1h' ? 4 : 1.6);
    const from = input.from ?? new Date(to.getTime() - span);
    const window = historyWindow(from, to, now);
    const instrument = await this.deps.resolver.resolve(input.symbol, parseMarket(input.market));
    const candles = await this.deps.repository.getCandles(
      instrument.id,
      input.resolution,
      window.from,
      window.to,
    );
    const sorted = [...candles].sort((a, b) => a.time.getTime() - b.time.getTime());
    return {
      ticker: instrument.ticker.value,
      resolution: input.resolution,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      candles: input.from ? sorted : sorted.slice(-bars),
    };
  }
}

export class GetMarketDepth {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: {
    symbol: string;
    market?: string;
    levels?: number;
  }): Promise<OrderBook & { ticker: string; spread: ReturnType<typeof spread> }> {
    const instrument = await this.deps.resolver.resolve(input.symbol, parseMarket(input.market));
    const book = await this.deps.repository.getOrderBook(instrument.id);
    const levels = Math.min(Math.max(input.levels ?? 10, 1), 50);
    const trimmed: OrderBook = {
      ...book,
      bids: book.bids.slice(0, levels),
      asks: book.asks.slice(0, levels),
    };
    return { ticker: instrument.ticker.value, ...trimmed, spread: spread(book) };
  }
}

export class GetRecentTrades {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: { symbol: string; market?: string; limit?: number; before?: string }): Promise<{
    ticker: string;
    trades: TapeTrade[];
    nextCursor: string | null;
  }> {
    const instrument = await this.deps.resolver.resolve(input.symbol, parseMarket(input.market));
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const trades = await this.deps.repository.getRecentTrades(instrument.id, limit, input.before);
    return { ticker: instrument.ticker.value, trades, nextCursor: trades.at(-1)?.cursor ?? null };
  }
}

export class GetMarketStatus {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(input: { market?: string }) {
    const market = parseMarket(input.market);
    const [session, indicators] = await Promise.all([
      this.deps.repository.getMarketSession(market),
      this.deps.repository.getMarketIndicators(market).catch(() => [] as Quote[]),
    ]);
    return {
      ...session,
      indices: indicators.map((q) => ({
        ticker: q.ticker.value,
        level: q.last,
        changePercent: q.changePercent,
        previousClose: q.previousClose,
      })),
    };
  }
}

export const SCREEN_SORT_FIELDS = [
  'changePercent',
  'value',
  'volume',
  'relativeVolume',
  'marketCap',
  'last',
  'dividendYieldPercent',
  'peRatio',
] as const;
export type ScreenSortField = (typeof SCREEN_SORT_FIELDS)[number];

export interface ScreenCriteria {
  market?: string;
  sector?: string;
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minValue?: number;
  minRelativeVolume?: number;
  maxPeRatio?: number;
  minDividendYield?: number;
  includeSuspended?: boolean;
  sortBy?: ScreenSortField;
  order?: 'asc' | 'desc';
  limit?: number;
}

/**
 * Screens the market snapshot. ThndrX evaluates screeners client-side on marketwatch rows (docs/api/market-data.md
 * §5.1); we do the same, which also powers "top gainers/losers/most active".
 */
export class ScreenMarket {
  constructor(private readonly deps: MarketDataDependencies) {}

  async execute(
    criteria: ScreenCriteria,
  ): Promise<{ market: Market; total: number; results: Array<Quote & { relativeVolume: number | null }> }> {
    const market = parseMarket(criteria.market);
    const all = await this.deps.quotes.get(market);
    const sector = criteria.sector?.trim().toLowerCase();
    const within = (value: number | null, min?: number, max?: number) =>
      (min === undefined || (value !== null && value >= min)) &&
      (max === undefined || (value !== null && value <= max));
    const rows = all
      .map((q) => ({ ...q, relativeVolume: relativeVolume(q) }))
      .filter(
        (q) =>
          (criteria.includeSuspended || !q.suspended) &&
          (!sector || (q.sector ?? '').toLowerCase().includes(sector)) &&
          within(q.last, criteria.minPrice, criteria.maxPrice) &&
          within(q.changePercent, criteria.minChangePercent, criteria.maxChangePercent) &&
          within(q.value, criteria.minValue) &&
          within(q.relativeVolume, criteria.minRelativeVolume) &&
          within(q.peRatio, undefined, criteria.maxPeRatio) &&
          within(q.dividendYieldPercent, criteria.minDividendYield),
      );
    const sortBy = criteria.sortBy ?? 'changePercent';
    const direction = criteria.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[sortBy];
      const y = b[sortBy];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction;
    });
    return {
      market,
      total: rows.length,
      results: rows.slice(0, Math.min(Math.max(criteria.limit ?? 20, 1), 100)),
    };
  }
}
