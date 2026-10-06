import type {
  NotificationDto,
  PriceAlertDto,
  WatchlistDto,
} from '../../../data-sources/thndr/dto/engagement';
import { parseTimestamp, toNumber, toStringOrNull } from '../../../data-sources/thndr/wire';
import { createNotification, type Notification } from '../../../domain/engagement/notification';
import {
  ALERT_DIRECTIONS,
  ALERT_FREQUENCIES,
  type AlertDirection,
  type AlertFrequency,
  createPriceAlert,
  type PriceAlert,
} from '../../../domain/engagement/price-alert';
import { createWatchlist, type Watchlist } from '../../../domain/engagement/watchlist';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { mapRows, parseAssetIdOrNull, parseTickerOrNull } from './market-data';

function idOrNull(raw: unknown): string | null {
  const id = toStringOrNull(raw)?.trim();
  return id ? id : null;
}

function textOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function enumOrNull<T extends string>(values: readonly T[], raw: unknown): T | null {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** Valid asset UUIDs of a wire list; anything else is dropped. */
export function toAssetIds(raw: unknown): AssetId[] {
  return mapRows(Array.isArray(raw) ? raw : [], parseAssetIdOrNull);
}

/** Maps one watchlist (§4.1). Returns null without an id; a missing name becomes `''`. */
export function toWatchlist(dto: WatchlistDto | null | undefined): Watchlist | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = idOrNull(dto.id);
  if (!id) return null;
  return createWatchlist({
    id,
    name: textOrNull(dto.name)?.trim() ?? '',
    instrumentIds: toAssetIds(dto.asset_ids),
    color: textOrNull(dto.color),
    icon: textOrNull(dto.icon),
  });
}

export function toAlertDirection(raw: unknown): AlertDirection | null {
  return enumOrNull(ALERT_DIRECTIONS, raw);
}

export function toAlertFrequency(raw: unknown): AlertFrequency | null {
  return enumOrNull(ALERT_FREQUENCIES, raw);
}

/** Maps one price alert (§5.2). Rows without an id, a valid asset id or a positive price yield null. */
export function toPriceAlert(dto: PriceAlertDto | null | undefined): PriceAlert | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = idOrNull(dto.id);
  const instrumentId = parseAssetIdOrNull(dto.asset_id);
  const targetPrice = toNumber(dto.price);
  if (!id || !instrumentId || targetPrice === null || targetPrice <= 0) return null;
  return createPriceAlert({
    id,
    instrumentId,
    ticker: parseTickerOrNull(dto.asset_symbol),
    targetPrice,
    direction: toAlertDirection(dto.direction),
    frequency: toAlertFrequency(dto.frequency),
    createdAt: parseTimestamp(dto.created_at),
  });
}

/** Maps one notification (misc §5). Rows without an id yield null. */
export function toNotification(dto: NotificationDto | null | undefined): Notification | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = idOrNull(dto.id);
  if (!id) return null;
  return createNotification({
    id,
    title: typeof dto.title === 'string' ? dto.title : null,
    text: typeof dto.text === 'string' ? dto.text : null,
    read: dto.is_read === true,
    createdAt: parseTimestamp(dto.created_at),
    type: textOrNull(dto.type) ?? textOrNull(dto.action),
  });
}
