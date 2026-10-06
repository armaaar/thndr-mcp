import type {
  DefaultMarketIndicatorsDto,
  DividendDto,
  DividendsResponseDto,
  ListedAssetDto,
  RankedAssetsDto,
  TagDto,
  TrendingAssetsDto,
  VisibleMarketsDto,
} from '../../../data-sources/thndr/dto/discovery';
import { parseTimestamp, toNumber, toStringOrNull } from '../../../data-sources/thndr/wire';
import type {
  Dividend,
  DividendDistribution,
  DividendPage,
  DividendStatus,
  DividendType,
  ListedInstrument,
  MarketAccess,
  Mover,
  MoverList,
  Tag,
  VisibleMarket,
} from '../../../domain/market-data/discovery';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import type { Market } from '../../../domain/shared-kernel/market';
import { marketFromWire } from '../markets';
import { mapCurrency, mapRows, parseAssetIdOrNull, toInstrument } from './market-data';

function stringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** `YYYY-MM-DD` from a date or datetime string; null otherwise. */
function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(raw.trim());
  return match ? match[0] : null;
}

/** Maps `visible-markets`: markets thndr-mcp serves (deduplicated), the default one, and the names it does not serve. */
export function toMarketAccess(dto: VisibleMarketsDto | null | undefined): MarketAccess {
  const markets: VisibleMarket[] = [];
  const otherMarkets: string[] = [];
  for (const entry of dto?.markets ?? []) {
    const name = stringOrNull(entry?.name);
    if (!entry || !name) continue;
    const market = marketFromWire(name);
    if (market === null) {
      if (!otherMarkets.includes(name)) otherMarkets.push(name);
      continue;
    }
    if (markets.some((m) => m.market === market)) continue;
    markets.push(
      Object.freeze({
        market,
        restricted: entry.is_restricted === true,
        restrictionReason: stringOrNull(entry.restriction_reason),
      }),
    );
  }
  return Object.freeze({
    markets: Object.freeze(markets),
    defaultMarket: marketFromWire(dto?.default_market),
    otherMarkets: Object.freeze(otherMarkets),
  });
}

/** Maps an asset payload with its feed; null when the id or ticker is missing. Odd symbols are sanitised. */
export function toListedInstrument(
  dto: ListedAssetDto | null | undefined,
  fallbackMarket: Market,
): ListedInstrument | null {
  if (!dto || typeof dto !== 'object') return null;
  const instrument = toInstrument({ ...dto, id: dto.id ?? dto.asset_id }, fallbackMarket, {
    sanitizeTicker: true,
  });
  if (!instrument) return null;
  const feed = dto.feed ?? {};
  // As ThndrX: the last trade price when there was one, else the feed's price (0 means "no price").
  const price = positiveOrNull(toNumber(feed.last_trade_price)) ?? positiveOrNull(toNumber(feed.price));
  return Object.freeze({
    instrument,
    price,
    previousClose: positiveOrNull(toNumber(feed.previous_close)),
    changePercent: toNumber(feed.last_change_prc),
  });
}

/** Maps `assets/rank`: ranked instruments in Thndr's order. */
export function toMoverList(dto: RankedAssetsDto | null | undefined, market: Market): MoverList {
  const movers = mapRows(dto?.assets_ranked, (row): Mover | null => {
    const listed = toListedInstrument(row, market);
    return listed
      ? Object.freeze({ ...listed, returnPercent: toNumber(row?.asset_return_percentage) })
      : null;
  });
  return Object.freeze({ movers: Object.freeze(movers), updatedAt: parseTimestamp(dto?.last_updated_at) });
}

/** Maps the trending ids; invalid ids are skipped, duplicates dropped. */
export function toTrendingIds(dto: TrendingAssetsDto | null | undefined): AssetId[] {
  return uniqueIds(mapRows(dto?.results, parseAssetIdOrNull));
}

/** Maps the default market indicators (an object live, a list of groups in older app code) to asset ids. */
export function toDefaultIndicatorIds(dto: DefaultMarketIndicatorsDto | null | undefined): AssetId[] {
  const raw = dto?.default_market_indicators;
  const groups = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const ids = groups.flatMap((group) =>
    mapRows(group?.indicators, (entry) => (entry ? parseAssetIdOrNull(entry.asset_id) : null)),
  );
  return uniqueIds(ids);
}

function uniqueIds(ids: readonly AssetId[]): AssetId[] {
  const seen = new Set<string>();
  return ids.filter((id) => !seen.has(id.value) && seen.add(id.value));
}

/** Maps one tag; null without an id or a name. */
export function toTag(dto: TagDto | null | undefined): Tag | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = toStringOrNull(dto.id);
  const name = stringOrNull(dto.name);
  if (!id || !name) return null;
  return Object.freeze({
    id,
    slug: stringOrNull(dto.slug),
    name,
    about: stringOrNull(dto.about),
    instrumentCount: toNumber(dto.assets_count),
    featured: dto.is_featured === true,
  });
}

function toDividendType(raw: unknown): DividendType {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return value === 'CASH' || value === 'STOCK' ? value : 'UNKNOWN';
}

function toDividendStatus(raw: unknown): DividendStatus {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return value === 'UPCOMING' || value === 'ONGOING' || value === 'PAST' ? value : 'UNKNOWN';
}

/** Maps one dividend; null without an id. */
export function toDividend(dto: DividendDto | null | undefined): Dividend | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = toStringOrNull(dto.id);
  if (!id) return null;
  const distributions = mapRows(dto.distributions, (row): DividendDistribution | null =>
    row && typeof row === 'object'
      ? Object.freeze({ date: isoDate(row.date), ratio: toNumber(row.ratio) ?? toNumber(row.amount) })
      : null,
  );
  return Object.freeze({
    id,
    type: toDividendType(dto.dividend_type),
    status: toDividendStatus(dto.status),
    recordDate: isoDate(dto.record_date),
    ratio: toNumber(dto.ratio),
    currency: mapCurrency(dto.currency),
    frequency: stringOrNull(dto.frequency),
    couponNumber: stringOrNull(toStringOrNull(dto.coupon_number)),
    distributions: Object.freeze(distributions),
  });
}

export function toDividendPage(dto: DividendsResponseDto | null | undefined): DividendPage {
  return Object.freeze({
    dividends: Object.freeze(mapRows(dto?.results, toDividend)),
    total: toNumber(dto?.total_count),
  });
}
