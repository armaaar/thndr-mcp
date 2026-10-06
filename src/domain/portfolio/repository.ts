import type { AssetId } from '../market-data/asset-id';
import type { Market } from '../market-data/market';
import type { AccountSummary } from './account-summary';
import type { ActivityPage } from './activity';
import type { ClosedTrade, DateRange, JournalPage, SellJournalEntry, TradingMetrics } from './journal';
import type { OrderStatusFilter, OrdersPage } from './order';
import type { Position } from './position';
import type { RealizedReturns, ReturnsInterval, ReturnsPoint } from './returns';
import type { SellableQuantity } from './sellable-quantity';

export interface AccountSnapshot {
  readonly summary: AccountSummary;
  readonly positions: readonly Position[];
}

export interface OrdersQuery {
  readonly market: Market;
  readonly status: OrderStatusFilter;
  readonly limit: number;
  readonly cursor?: string;
  readonly instrumentId?: AssetId;
  readonly sortOrder?: 'ASC' | 'DESC';
}

export interface JournalQuery extends DateRange {
  readonly market: Market;
  readonly page: number;
  readonly limit: number;
  readonly ticker?: string;
}

/** Read-only access to the user's account (ADR 0006: no order entry, no fund movement). */
export interface PortfolioRepository {
  /** Cash balances, portfolio totals and every position of one market account. */
  getAccount(market: Market): Promise<AccountSnapshot>;
  /** A single position, or null when the user does not hold the instrument. */
  getPosition(id: AssetId, market: Market): Promise<Position | null>;
  getSellableQuantity(id: AssetId, market: Market): Promise<SellableQuantity>;
  listOrders(query: OrdersQuery): Promise<OrdersPage>;
  getRealizedReturns(market: Market): Promise<RealizedReturns>;
  getReturnsChart(interval: ReturnsInterval, market: Market): Promise<ReturnsPoint[]>;
  getClosedTrades(query: JournalQuery): Promise<JournalPage<ClosedTrade>>;
  getSellJournal(query: JournalQuery): Promise<JournalPage<SellJournalEntry>>;
  /** Journal statistics across every market (Thndr takes no market for this one). */
  getTradingMetrics(range: DateRange): Promise<TradingMetrics>;
  listActivities(market: Market, page: number, pageSize: number): Promise<ActivityPage>;
}
