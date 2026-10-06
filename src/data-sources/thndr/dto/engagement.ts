/**
 * Wire formats of Thndr's watchlist, price-alert and notification endpoints (docs/api/market-data.md §4, §5.2 and
 * misc §5). Loosely typed on purpose: mappers must tolerate missing or re-typed values.
 */
import type { WireNumber } from './market-data';

/** One custom watchlist (§4.1). The detail endpoint may return only `asset_ids`. */
export interface WatchlistDto {
  id?: string | number | null;
  name?: string | null;
  color?: string | null;
  icon?: string | null;
  count?: WireNumber;
  asset_ids?: unknown[] | null;
}

/** `GET /users-service/watchlists?market=` (§4.1). */
export interface WatchlistsResponseDto {
  watchlists?: WatchlistDto[] | null;
}

/** `POST /users-service/watchlists` body (§4.1). */
export interface CreateWatchlistBodyDto {
  name: string;
  market: string;
  source: 'thndrx';
  asset_ids: string[];
}

/** `POST /users-service/watchlists/{id}/watch-assets|unwatch-assets` body (§4.1). */
export interface WatchAssetsBodyDto {
  asset_ids: string[];
}

/** One price alert (§5.2). */
export interface PriceAlertDto {
  id?: string | number | null;
  asset_id?: string | null;
  asset_symbol?: string | null;
  price?: WireNumber;
  frequency?: string | null;
  direction?: string | null;
  created_at?: string | number | null;
}

/** `GET /price-alerts/v1/alerts` and `/asset-alerts/{id}` (§5.2); may also carry krakend `error_*` keys. */
export interface PriceAlertsPageDto {
  results?: PriceAlertDto[] | null;
  [key: string]: unknown;
}

/** `POST /price-alerts/v1/alerts` body (§5.2). */
export interface CreatePriceAlertBodyDto {
  asset_id: string;
  price: number;
  frequency: string;
  direction: string;
  market: string;
}

/** One notification (misc §5). */
export interface NotificationDto {
  id?: string | number | null;
  title?: string | null;
  text?: string | null;
  is_read?: boolean | null;
  created_at?: string | number | null;
  type?: string | null;
  action?: string | null;
}

/** `GET /notifications/v1/has-unread` (misc §5). */
export interface HasUnreadDto {
  has_unread?: boolean | null;
  [key: string]: unknown;
}

/** `PATCH /notifications/v1/batch?field=is_read` body (misc §5). */
export type NotificationBatchBodyDto = Array<{ id: string }>;
