import type {
  ChartsResponseDto,
  GatewayDaySideDto,
  GatewayPriceResponseDto,
  GatewayPriceRowDto,
  GatewayPriceValueDto,
} from '../../../data-sources/thndr/dto/market-data';
import { parseTimestamp, toNumber } from '../../../data-sources/thndr/wire';
import { type ClosePoint, type CloseSpan, createClosePoint } from '../../../domain/market-data/close-series';
import type { LatestPrice, LatestPriceKind } from '../../../domain/market-data/latest-price';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { parseAssetIdOrNull } from './market-data';

/** Domain close span → `option` of `assets-service/charts` (docs/api/mobile-app.md §2.4). */
export const WIRE_CLOSE_OPTION: Readonly<Record<CloseSpan, string>> = {
  '1d': '1d',
  '1w': '1w',
  '1M': '1M',
  '6M': '6M',
  '1y': '1y',
  '2y': '2y',
  all: 'all',
};

/**
 * The gateway stamps prices in epoch **nanoseconds** (e.g. 1791286273092667000); seconds, milliseconds and ISO
 * strings are tolerated too.
 */
export function parseGatewayTimestamp(raw: unknown): Date | null {
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof n === 'number' && Number.isFinite(n) && n > 1e15) return new Date(Math.floor(n / 1e6));
  return parseTimestamp(n);
}

function readingValue(reading: GatewayPriceValueDto | null | undefined): number | null {
  return reading && typeof reading === 'object' ? toNumber(reading.value) : null;
}

function kindOf(field: unknown): LatestPriceKind {
  if (field === 'last_trade_price') return 'trade';
  if (field === 'close' || field === 'close_price') return 'close';
  return 'unknown';
}

interface PriceParts {
  last: number | null;
  kind: LatestPriceKind;
  at: Date | null;
  bid: number | null;
  ask: number | null;
}

/** The transactional price wins; funds have a NAV and FX rows a rate instead (ThndrApp `mapPriceToEntity`). */
function priceParts(row: GatewayPriceRowDto | undefined): PriceParts {
  const price = row?.price && typeof row.price === 'object' ? row.price : {};
  const bid = readingValue(price.bid);
  const ask = readingValue(price.ask);
  const last = readingValue(price.last);
  if (last !== null)
    return {
      last,
      kind: kindOf(price.last?.price_field),
      at: parseGatewayTimestamp(price.last?.market_effective_timestamp),
      bid,
      ask,
    };
  for (const [kind, reading] of [
    ['nav', price.nav],
    ['rate', price.rate],
  ] as const) {
    const value = readingValue(reading);
    if (value !== null)
      return { last: value, kind, at: parseGatewayTimestamp(reading?.market_effective_timestamp), bid, ask };
  }
  return { last: null, kind: 'unknown', at: null, bid, ask };
}

function daySide(side: GatewayDaySideDto | null | undefined): GatewayDaySideDto {
  return side && typeof side === 'object' ? side : {};
}

/**
 * Maps `securities/v2/price` (live sample 2026-10-06): one latest price per asset id present in either section. The
 * day snapshot gives open and previous close (and the close when the price section has no value); rows without any
 * price are dropped.
 */
export function toLatestPrices(dto: GatewayPriceResponseDto | null | undefined): LatestPrice[] {
  const prices = new Map<string, GatewayPriceRowDto>();
  for (const row of Array.isArray(dto?.price?.results) ? dto.price.results : []) {
    if (!row || typeof row !== 'object') continue;
    const id = parseAssetIdOrNull(row.asset_id);
    if (id) prices.set(id.value, row);
  }
  const days = new Map<string, GatewayDaySideDto>();
  for (const row of Array.isArray(dto?.day_snapshot?.results) ? dto.day_snapshot.results : []) {
    if (!row || typeof row !== 'object') continue;
    const id = parseAssetIdOrNull(row.asset_id);
    if (id) days.set(id.value, daySide(row.day_snapshot?.last ?? row.day_snapshot?.rate));
  }
  const out: LatestPrice[] = [];
  for (const raw of new Set([...prices.keys(), ...days.keys()])) {
    const id = parseAssetIdOrNull(raw) as AssetId;
    const parts = priceParts(prices.get(raw));
    const day = days.get(raw) ?? {};
    const dayClose = toNumber(day.close);
    const last = parts.last ?? dayClose;
    if (last === null) continue;
    out.push(
      Object.freeze({
        instrumentId: id,
        last,
        kind: parts.last !== null ? parts.kind : 'close',
        at: parts.last !== null ? parts.at : parseGatewayTimestamp(day.market_effective_timestamp),
        open: toNumber(day.open),
        previousClose: toNumber(day.previous_close),
        bid: parts.bid,
        ask: parts.ask,
      }),
    );
  }
  return out;
}

/** Maps `assets-service/charts` for one asset: `{<id>: {<ISO time>: close}}` → close points, oldest first. */
export function toClosePoints(dto: ChartsResponseDto | undefined, id: AssetId): ClosePoint[] {
  const series = dto && typeof dto === 'object' ? dto[id.value] : null;
  if (!series || typeof series !== 'object') return [];
  const points: ClosePoint[] = [];
  for (const [time, raw] of Object.entries(series)) {
    const at = parseTimestamp(time);
    const close = toNumber(raw);
    if (at === null || close === null || !(close > 0)) continue;
    points.push(createClosePoint(at, close));
  }
  return points.sort((a, b) => a.time.getTime() - b.time.getTime());
}
