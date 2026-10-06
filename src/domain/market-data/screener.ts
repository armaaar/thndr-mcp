import type { Market } from '../shared-kernel/market';
import type { Quote } from './instrument';

/**
 * What a screener filter can test. Most are quote fields; six are derived the way ThndrX derives them when it
 * evaluates a screener (docs/api/market-data.md §5.1): `price`, `change`, `changePercent`, `relativeVolume`,
 * `week52HighDistance` and `week52LowDistance`.
 */
export const SCREENER_FIELDS = [
  'price',
  'change',
  'changePercent',
  'relativeVolume',
  'week52HighDistance',
  'week52LowDistance',
  'ticker',
  'name',
  'sector',
  'value',
  'volume',
  'trades',
  'lastTradePrice',
  'lastTradeVolume',
  'previousClose',
  'open',
  'high',
  'low',
  'bid',
  'ask',
  'bidSize',
  'askSize',
  'listedShares',
  'peRatio',
  'eps',
  'dividendYieldPercent',
  'averageVolume5d',
  'averageVolume30d',
  'averageVolume90d',
  'week52High',
  'week52Low',
] as const;
export type ScreenerField = (typeof SCREENER_FIELDS)[number];

/** How a filter tests its field (ThndrX filter types `NumberRange`, `StringArray`, `StringLoose`, `String`, `Number`). */
export type ScreenerCondition =
  /** Inclusive range; a null bound is open. */
  | { readonly kind: 'between'; readonly min: number | null; readonly max: number | null }
  /** The field equals one of the values (exact, case-sensitive). */
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  /** The field contains the text, ignoring case. */
  | { readonly kind: 'contains'; readonly text: string }
  | { readonly kind: 'equals'; readonly value: string }
  | { readonly kind: 'equalsNumber'; readonly value: number };

export interface ScreenerFilter {
  readonly field: ScreenerField;
  readonly condition: ScreenerCondition;
}

/** A named set of filters: one of the user's saved screeners or one of ThndrX's built-in presets. */
export interface Screener {
  readonly id: string;
  readonly name: string;
  readonly market: Market | null;
  /** True for ThndrX's built-in "recommended screeners". */
  readonly preset: boolean;
  readonly filters: readonly ScreenerFilter[];
  /** Filters Thndr stored that cannot be evaluated here (unknown filter key or type), described for the user. */
  readonly unsupported: readonly string[];
}

/**
 * ThndrX's built-in "recommended screeners" (client-side constants, bundle module 22462 in `chunks_2409…js`), in
 * ThndrX's order and with its English names. They are not stored on the server.
 */
export const SCREENER_PRESET_IDS = [
  'momentum-movers',
  'breakout-radar',
  'value-yield',
  'steady-performers',
  'reversal-watch',
] as const;
export type ScreenerPresetId = (typeof SCREENER_PRESET_IDS)[number];

const atLeast = (field: ScreenerField, min: number): ScreenerFilter => ({
  field,
  condition: { kind: 'between', min, max: null },
});
const atMost = (field: ScreenerField, max: number): ScreenerFilter => ({
  field,
  condition: { kind: 'between', min: null, max },
});

function preset(id: ScreenerPresetId, name: string, filters: ScreenerFilter[]): Screener {
  return deepFreeze({ id, name, market: null, preset: true, filters, unsupported: [] });
}

export const SCREENER_PRESETS: readonly Screener[] = Object.freeze([
  preset('momentum-movers', 'Momentum Movers', [
    atLeast('value', 1_000_000),
    atLeast('relativeVolume', 100),
    atMost('week52HighDistance', 10),
    atLeast('changePercent', 2),
  ]),
  preset('breakout-radar', 'Breakout Radar', [
    atLeast('value', 2_000_000),
    atLeast('relativeVolume', 100),
    atMost('week52HighDistance', 5),
    atLeast('changePercent', 0),
  ]),
  preset('value-yield', 'Value & Yield', [
    atMost('week52HighDistance', 20),
    atLeast('dividendYieldPercent', 4),
    {
      field: 'sector',
      condition: {
        kind: 'oneOf',
        values: ['Non-bank financial services', 'Real Estate', 'Textile & Durables', 'Basic Resources'],
      },
    },
  ]),
  preset('steady-performers', 'Steady Performers', [
    atLeast('relativeVolume', 70),
    atMost('week52HighDistance', 15),
    atLeast('changePercent', 0),
    atLeast('dividendYieldPercent', 2),
  ]),
  preset('reversal-watch', 'Reversal Watch', [
    atLeast('relativeVolume', 100),
    atMost('week52LowDistance', 5),
    atLeast('changePercent', -2),
  ]),
]);

/** Freezes a screener and everything it holds. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** ThndrX `jW`: |last − reference| / reference in percent, rounded to an integer; 0 when either is 0. */
function distancePercent(reference: number, last: number): number {
  if (!reference || !last) return 0;
  const distance = Math.abs(((last - reference) / reference) * 100);
  return distance === Number.POSITIVE_INFINITY ? 0 : Number.parseInt(distance.toFixed(0), 10);
}

type FieldValue = number | string | null;

/**
 * The value ThndrX's screener sees for `field` on a marketwatch row. Derived fields use ThndrX's formulas, including
 * its quirks: they read `lastTradePrice` (0 before the first trade of the day) rather than `last`, and treat missing
 * numbers as 0 (`a ?? 0`). Relative volume is rounded to an integer and is null when volume or the 30-day average is
 * 0 or missing.
 */
export function screenerValue(quote: Quote, field: ScreenerField): FieldValue {
  const traded = quote.lastTradePrice ?? 0;
  const previous = quote.previousClose ?? 0;
  switch (field) {
    case 'price':
      // ThndrX: `last_trade_price !== 0 ? last_trade_price : close_price ?? 0` (`last` is that close when 0).
      return quote.lastTradePrice === 0 ? (quote.last ?? 0) : quote.lastTradePrice;
    case 'change':
      return traded - previous;
    case 'changePercent':
      return ((traded - previous) / previous) * 100;
    case 'relativeVolume': {
      const volume = quote.volume ?? 0;
      const average = quote.averageVolume30d ?? 0;
      return volume === 0 || average === 0 ? null : Number(((volume / average) * 100).toFixed(0));
    }
    case 'week52HighDistance':
      return distancePercent(quote.week52High ?? 0, traded);
    case 'week52LowDistance':
      return distancePercent(quote.week52Low ?? 0, traded);
    case 'ticker':
      return quote.ticker.value;
    default:
      return quote[field];
  }
}

/** JavaScript's `Number(x)`, which ThndrX applies to the field before a numeric test (`Number(null)` is 0). */
function asNumber(value: FieldValue): number {
  return Number(value);
}

/** Whether one quote passes one filter, with ThndrX's semantics (module 86697 in `chunks_2409…js`). */
export function matchesFilter(quote: Quote, filter: ScreenerFilter): boolean {
  const value = screenerValue(quote, filter.field);
  // ThndrX rejects the row outright when relative volume cannot be computed.
  if (filter.field === 'relativeVolume' && value === null) return false;
  const condition = filter.condition;
  switch (condition.kind) {
    case 'between': {
      const number = asNumber(value);
      const min = condition.min ?? Number.NEGATIVE_INFINITY;
      const max = condition.max ?? Number.POSITIVE_INFINITY;
      return number >= min && number <= max;
    }
    case 'oneOf':
      return typeof value === 'string' && condition.values.includes(value);
    case 'contains':
      return String(value || '')
        .toLowerCase()
        .includes(condition.text.toLowerCase());
    case 'equals':
      return String(value || '') === condition.value;
    case 'equalsNumber':
      return asNumber(value) === condition.value;
  }
}

/** Whether a quote passes every filter. */
export function matchesScreener(quote: Quote, filters: readonly ScreenerFilter[]): boolean {
  return filters.every((filter) => matchesFilter(quote, filter));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value);
}

/** A filter in plain words, e.g. `value ≥ 1,000,000`, `5 ≤ peRatio ≤ 10`, `sector is one of Banks, Real Estate`. */
export function describeFilter(filter: ScreenerFilter): string {
  const { field, condition } = filter;
  switch (condition.kind) {
    case 'between':
      if (condition.min !== null && condition.max !== null) {
        return `${formatNumber(condition.min)} ≤ ${field} ≤ ${formatNumber(condition.max)}`;
      }
      if (condition.min !== null) return `${field} ≥ ${formatNumber(condition.min)}`;
      if (condition.max !== null) return `${field} ≤ ${formatNumber(condition.max)}`;
      return `${field} (any value)`;
    case 'oneOf':
      return `${field} is one of ${condition.values.join(', ')}`;
    case 'contains':
      return `${field} contains "${condition.text}"`;
    case 'equals':
      return `${field} = "${condition.value}"`;
    case 'equalsNumber':
      return `${field} = ${formatNumber(condition.value)}`;
  }
}
