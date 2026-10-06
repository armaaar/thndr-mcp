import type { ScreenerDto, ScreenerFilterDto } from '../../../data-sources/thndr/dto/market-data';
import {
  deepFreeze,
  type Screener,
  type ScreenerCondition,
  type ScreenerField,
  type ScreenerFilter,
} from '../../../domain/market-data/screener';
import type { Market } from '../../../domain/shared-kernel/market';
import { marketFromWire } from '../markets';

/**
 * ThndrX screener filter keys (§5.1) → the quote field (or derived field) they test. The derived keys are computed
 * by ThndrX's evaluator (module 86697); every other key reads the marketwatch row's field of that name. Keys that
 * are not listed here cannot be evaluated on our quotes (e.g. `ref_price`, `total_bids`).
 */
export const SCREENER_KEYS: Readonly<Record<string, ScreenerField>> = Object.freeze({
  price: 'price',
  last_change: 'change',
  last_change_prc: 'changePercent',
  relative_volume: 'relativeVolume',
  high_52_week_distance: 'week52HighDistance',
  low_52_week_distance: 'week52LowDistance',
  reuters: 'ticker',
  eng_name: 'name',
  eng_desc: 'sector',
  total_value: 'value',
  total_volume: 'volume',
  total_trades: 'trades',
  last_trade_price: 'lastTradePrice',
  last_trade_volume: 'lastTradeVolume',
  previous_close: 'previousClose',
  open_price: 'open',
  high_price: 'high',
  low_price: 'low',
  bid_price: 'bid',
  ask_price: 'ask',
  bid_volume: 'bidSize',
  ask_volume: 'askSize',
  listed_shares: 'listedShares',
  pe_ratio: 'peRatio',
  eps: 'eps',
  dividend_yield_perc: 'dividendYieldPercent',
  avg_5_day: 'averageVolume5d',
  avg_30_day: 'averageVolume30d',
  avg_90_day: 'averageVolume90d',
  high_52_week: 'week52High',
  low_52_week: 'week52Low',
});

/**
 * ThndrX: `t.min_value ? Number(t.min_value) : ±Infinity` — a falsy bound (missing, `""`, `0`) is open; the string
 * `"0"` is a real bound. Returns undefined for a bound that is not a number (ThndrX would then match nothing).
 */
function bound(raw: unknown): number | null | undefined {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

type Translated = { filter: ScreenerFilter } | { unsupported: string };

function toCondition(dto: ScreenerFilterDto, key: string): ScreenerCondition | string {
  const type = typeof dto.type === 'string' ? dto.type : '';
  switch (type) {
    case 'NumberRange': {
      const min = bound(dto.min_value);
      const max = bound(dto.max_value);
      if (min === undefined || max === undefined) return `"${key}": bounds are not numbers`;
      return { kind: 'between', min, max };
    }
    case 'StringArray': {
      let values: unknown;
      try {
        values = JSON.parse(typeof dto.value === 'string' && dto.value !== '' ? dto.value : '[]');
      } catch {
        return `"${key}": value is not a JSON list`;
      }
      if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
        return `"${key}": value is not a list of strings`;
      }
      return { kind: 'oneOf', values };
    }
    case 'StringLoose':
      return { kind: 'contains', text: String(dto.value || '') };
    case 'String':
      return { kind: 'equals', value: String(dto.value || '') };
    case 'Number': {
      const value = Number(dto.value);
      return Number.isFinite(value) ? { kind: 'equalsNumber', value } : `"${key}": value is not a number`;
    }
    default:
      return `"${key}": filter type "${type}" is not supported`;
  }
}

/** Maps one wire filter to a domain filter, or explains why it cannot be evaluated. */
export function toScreenerFilter(dto: ScreenerFilterDto | null | undefined): Translated {
  const key = dto && typeof dto.filter_key === 'string' ? dto.filter_key : '';
  if (!dto || key === '') return { unsupported: 'a filter without a filter key' };
  const field = Object.hasOwn(SCREENER_KEYS, key) ? SCREENER_KEYS[key] : undefined;
  if (!field) return { unsupported: `filter key "${key}" is not supported` };
  const condition = toCondition(dto, key);
  if (typeof condition === 'string') return { unsupported: condition };
  return { filter: { field, condition } };
}

/** Maps a saved screener (§5.1); null without an id. */
export function toScreener(
  dto: ScreenerDto | null | undefined,
  fallbackMarket: Market | null,
): Screener | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = typeof dto.id === 'string' && dto.id.trim() !== '' ? dto.id : null;
  if (!id) return null;
  const filters: ScreenerFilter[] = [];
  const unsupported: string[] = [];
  for (const raw of Array.isArray(dto.filters) ? dto.filters : []) {
    const translated = toScreenerFilter(raw);
    if ('filter' in translated) filters.push(translated.filter);
    else unsupported.push(translated.unsupported);
  }
  const market = marketFromWire(dto.market) ?? fallbackMarket;
  return deepFreeze({
    id,
    name: typeof dto.name === 'string' && dto.name.trim() !== '' ? dto.name : id,
    market,
    preset: false,
    filters,
    unsupported,
  });
}
