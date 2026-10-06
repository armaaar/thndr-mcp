import { UpstreamError } from '../../../application/errors.js';
import type { AssetId } from '../../../domain/market-data/asset-id.js';
import type { Market } from '../../../domain/market-data/market.js';
import type { ActivityPage } from '../../../domain/portfolio/activity.js';
import type {
  ClosedTrade,
  DateRange,
  JournalPage,
  SellJournalEntry,
  TradingMetrics,
} from '../../../domain/portfolio/journal.js';
import type { OrderStatusFilter, OrdersPage } from '../../../domain/portfolio/order.js';
import type { Position } from '../../../domain/portfolio/position.js';
import type {
  AccountSnapshot,
  JournalQuery,
  OrdersQuery,
  PortfolioRepository,
} from '../../../domain/portfolio/repository.js';
import type { RealizedReturns, ReturnsInterval, ReturnsPoint } from '../../../domain/portfolio/returns.js';
import type { SellableQuantity } from '../../../domain/portfolio/sellable-quantity.js';
import type {
  AccountActivitiesResponseDto,
  BlockedQuantitiesDto,
  FullTradesResponseDto,
  GroupedSellsResponseDto,
  OrdersPageDto,
  PositionDto,
  RealizedReturnsDto,
  ReturnsPointDto,
  TradingMetricsDto,
  WalletAndPortfolioDto,
} from '../../data-sources/thndr/dto/portfolio.js';
import type { ThndrHttpClient } from '../../data-sources/thndr/http-client.js';
import { assertNoKrakendError } from '../../data-sources/thndr/krakend.js';
import { toNumber, toStringOrNull } from '../../data-sources/thndr/wire.js';
import { mapRows } from './translators/market-data.js';
import {
  toAccountActivity,
  toAccountSnapshot,
  toClosedTrade,
  toOrder,
  toPosition,
  toRealizedReturns,
  toReturnsPoint,
  toSellableQuantity,
  toSellJournalEntry,
  toTradingMetrics,
} from './translators/portfolio.js';

/** Domain status filter → `status` query value of `GET /market-service/v3/orders` (§3.1). */
export const WIRE_ORDER_STATUS: Record<OrderStatusFilter, string | undefined> = {
  all: undefined,
  open: 'PENDING',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  closed: 'CLOSED',
};

/** `provider` of `GET /funding-service/account-activities` per market (§5.1). */
export const ACTIVITY_PROVIDER: Record<Market, string> = { egypt: 'EGID', us: 'ALPACA' };

/**
 * Read-only adapter for Thndr's account, portfolio, order-history, journal and activity endpoints
 * (docs/api/trading-and-portfolio.md). It intentionally implements no order entry or fund movement (ADR 0006).
 * `api` targets https://prod.thndr.app, `krakend` https://prod.thndr.app/krakend-thndr-x; every krakend response
 * goes through {@link assertNoKrakendError}.
 */
export class ThndrPortfolioRepository implements PortfolioRepository {
  constructor(
    private readonly api: ThndrHttpClient,
    private readonly krakend: ThndrHttpClient,
  ) {}

  async getAccount(market: Market): Promise<AccountSnapshot> {
    const data = await this.api.get<WalletAndPortfolioDto>('/market-service/accounts/wallet-and-portfolio', {
      query: { market },
    });
    return toAccountSnapshot(data, market);
  }

  async getPosition(id: AssetId, market: Market): Promise<Position | null> {
    const path = `/portfolio/v1/position/${encodeURIComponent(id.value)}`;
    try {
      const data = await this.krakend.get<PositionDto>(path, { query: { market } });
      assertNoKrakendError(data, `GET ${path}`);
      return toPosition(data, market);
    } catch (error) {
      // ThndrX: a 404 means "not held".
      if (error instanceof UpstreamError && error.status === 404) return null;
      throw error;
    }
  }

  async getSellableQuantity(id: AssetId, market: Market): Promise<SellableQuantity> {
    const data = await this.api.get<BlockedQuantitiesDto>(
      `/market-service/accounts/positions/blocked-quantities/${encodeURIComponent(id.value)}`,
      { query: { market } },
    );
    return toSellableQuantity(data);
  }

  async listOrders(query: OrdersQuery): Promise<OrdersPage> {
    const data = await this.api.get<OrdersPageDto>('/market-service/v3/orders', {
      query: {
        market: query.market,
        status: WIRE_ORDER_STATUS[query.status],
        cursor: query.cursor || undefined,
        limit: query.limit,
        sort_order: query.sortOrder ?? 'DESC',
        skip_funds: true,
        asset_id: query.instrumentId?.value,
      },
    });
    const cursor = toStringOrNull(data?.cursor);
    return Object.freeze({
      orders: Object.freeze(mapRows(data?.data, toOrder)),
      nextCursor: data?.has_next === true && cursor ? cursor : null,
    });
  }

  async getRealizedReturns(market: Market): Promise<RealizedReturns> {
    const data = await this.api.get<RealizedReturnsDto>('/market-service/realized-returns', {
      query: { market },
    });
    return toRealizedReturns(data);
  }

  async getReturnsChart(interval: ReturnsInterval, market: Market): Promise<ReturnsPoint[]> {
    const data = await this.api.get<ReturnsPointDto[]>(
      `/market-service/realized-returns/chart/${encodeURIComponent(interval)}`,
      { query: { market } },
    );
    return mapRows(data, toReturnsPoint);
  }

  async getClosedTrades(query: JournalQuery): Promise<JournalPage<ClosedTrade>> {
    const data = await this.api.get<FullTradesResponseDto>('/market-service/trading-journals/full-trades', {
      query: journalParams(query),
    });
    const entries = mapRows(data?.full_trades, toClosedTrade);
    const rows = Array.isArray(data?.full_trades) ? data.full_trades.length : 0;
    const totalCount = toNumber(data?.total_count);
    // ThndrX: next page while the rows seen so far are fewer than `total_count`.
    const hasMore =
      totalCount === null ? rows === query.limit : (query.page - 1) * query.limit + rows < totalCount;
    return Object.freeze({ entries: Object.freeze(entries), totalCount, page: query.page, hasMore });
  }

  async getSellJournal(query: JournalQuery): Promise<JournalPage<SellJournalEntry>> {
    const path = '/trading-journals/v1/grouped-sells';
    const data = await this.krakend.get<GroupedSellsResponseDto>(path, { query: journalParams(query) });
    assertNoKrakendError(data, `GET ${path}`);
    const rows = Array.isArray(data?.sell_journals) ? data.sell_journals.length : 0;
    return Object.freeze({
      entries: Object.freeze(mapRows(data?.sell_journals, toSellJournalEntry)),
      totalCount: toNumber(data?.total_count),
      page: query.page,
      // ThndrX: next page while a full page came back.
      hasMore: rows > 0 && rows === query.limit,
    });
  }

  async getTradingMetrics(range: DateRange): Promise<TradingMetrics> {
    const path = '/trading-journals/v1/trading-metrics';
    const data = await this.krakend.get<TradingMetricsDto>(path, {
      query: { from_date: range.from?.toISOString(), to_date: range.to?.toISOString() },
    });
    assertNoKrakendError(data, `GET ${path}`);
    return toTradingMetrics(data);
  }

  async listActivities(market: Market, page: number, pageSize: number): Promise<ActivityPage> {
    const data = await this.api.get<AccountActivitiesResponseDto>('/funding-service/account-activities', {
      query: { provider: ACTIVITY_PROVIDER[market], page_size: pageSize, page },
    });
    const rows = Array.isArray(data?.results) ? data.results.length : 0;
    return Object.freeze({
      activities: Object.freeze(mapRows(data?.results, toAccountActivity)),
      page,
      hasMore: rows > 0 && rows === pageSize,
    });
  }
}

function journalParams(query: JournalQuery) {
  return {
    market: query.market,
    page: query.page,
    limit: query.limit,
    symbol_code: query.ticker,
    from_date: query.from?.toISOString(),
    to_date: query.to?.toISOString(),
  };
}
