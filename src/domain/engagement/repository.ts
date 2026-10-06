import type { AssetId } from '../market-data/asset-id';
import type { Market } from '../market-data/market';
import type { Notification } from './notification';
import type { AlertDirection, AlertFrequency, PriceAlert } from './price-alert';
import type { Watchlist, WatchlistName } from './watchlist';

export interface PageRequest {
  /** 1-based page number. */
  page: number;
  pageCount: number;
}

export interface NewPriceAlert {
  instrumentId: AssetId;
  price: number;
  direction: AlertDirection;
  frequency: AlertFrequency;
  market: Market;
}

/** Watchlists, price alerts and notifications (docs/api/market-data.md §4, §5.2 and misc §5). */
export interface EngagementRepository {
  listWatchlists(market: Market): Promise<Watchlist[]>;
  /** The detail payload may omit the name/colour; those then come back empty/null. */
  getWatchlist(id: string): Promise<Watchlist>;
  createWatchlist(name: WatchlistName, market: Market, instrumentIds: readonly AssetId[]): Promise<Watchlist>;
  renameWatchlist(id: string, name: WatchlistName): Promise<void>;
  deleteWatchlist(id: string): Promise<void>;
  addToWatchlist(id: string, instrumentIds: readonly AssetId[]): Promise<void>;
  removeFromWatchlist(id: string, instrumentIds: readonly AssetId[]): Promise<void>;

  listPriceAlerts(market: Market, page: PageRequest): Promise<PriceAlert[]>;
  listAlertsForInstrument(instrumentId: AssetId): Promise<PriceAlert[]>;
  /** Returns the created alert, or null when Thndr's response does not describe it. */
  createPriceAlert(alert: NewPriceAlert): Promise<PriceAlert | null>;
  /** Idempotent: deleting an alert that no longer exists succeeds. */
  deletePriceAlert(id: string): Promise<void>;

  listNotifications(page: number, pageCount: number): Promise<Notification[]>;
  hasUnreadNotifications(): Promise<boolean>;
  markNotificationsRead(ids: readonly string[]): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
}
