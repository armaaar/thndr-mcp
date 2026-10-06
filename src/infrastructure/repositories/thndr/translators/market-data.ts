import { AssetId } from '../../../../domain/market-data/asset-id';
import { type Candle, type CandleResolution, createCandle } from '../../../../domain/market-data/candle';
import type { Instrument, Quote } from '../../../../domain/market-data/instrument';
import { MARKETS, type Market, parseAssetClass } from '../../../../domain/market-data/market';
import type { BookLevel, OrderBook, TapeTrade, TradeSide } from '../../../../domain/market-data/order-book';
import type { Currency } from '../../../../domain/shared-kernel/money';
import { Ticker } from '../../../../domain/shared-kernel/ticker';
import type {
  AssetDto,
  CandleDto,
  DepthLevelDto,
  MarketDepthResponseDto,
  MarketIndicatorDto,
  MarketwatchAssetDto,
  TradeDto,
} from '../../../data-sources/thndr/dto/market-data';
import { parseTimestamp, toNumber, toStringOrNull } from '../../../data-sources/thndr/wire';

/** Domain candle resolution → Thndr `resolution` query value (§2.2). */
export const WIRE_RESOLUTION: Record<CandleResolution, string> = {
  '1min': '1MIN',
  '5min': '5MIN',
  '10min': '10MIN',
  '1h': '1HR',
  '1d': '1D',
  '1w': '1W',
};

/** Thndr currency codes (§0.4): 1 → EGP, 2 → USD, 0 (index points) and anything else → null. */
export function mapCurrency(raw: unknown): Currency | null {
  if (raw === 1 || raw === '1') return 'EGP';
  if (raw === 2 || raw === '2') return 'USD';
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (upper === 'EGP' || upper === 'USD') return upper;
  }
  return null;
}

export function parseAssetIdOrNull(raw: unknown): AssetId | null {
  return typeof raw === 'string' && AssetId.isAssetId(raw) ? AssetId.of(raw) : null;
}

export function parseTickerOrNull(raw: unknown): Ticker | null {
  if (typeof raw !== 'string') return null;
  try {
    return Ticker.of(raw);
  } catch {
    return null;
  }
}

/**
 * Thndr reference symbols (indices, FX rates) do not always fit the domain `Ticker` pattern
 * (`/^[A-Z0-9][A-Z0-9._-]{0,14}$/`): e.g. `USD/EGP` or `EGX70 EWI`. Rather than dropping them we sanitise them:
 * every character outside `[A-Z0-9._-]` becomes `-`, leading non-alphanumerics are stripped and the result is
 * truncated to 15 characters (`USD/EGP` → `USD-EGP`, `EGX70 EWI` → `EGX70-EWI`). Returns null when nothing
 * usable remains.
 */
export function sanitizeTicker(raw: unknown): Ticker | null {
  if (typeof raw !== 'string') return null;
  const exact = parseTickerOrNull(raw);
  if (exact) return exact;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, '-')
    .replace(/^[^A-Z0-9]+/, '')
    .slice(0, 15);
  return parseTickerOrNull(cleaned);
}

function stringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function booleanOrNull(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

function marketOrDefault(raw: unknown, fallback: Market): Market {
  return typeof raw === 'string' && (MARKETS as readonly string[]).includes(raw) ? (raw as Market) : fallback;
}

/** `is_3dp` drives TradingView's pricescale (1000 vs 100); `round_digits` wins when present. */
function priceDecimals(dto: AssetDto): number | null {
  const digits = toNumber(dto.round_digits);
  if (digits !== null && Number.isInteger(digits) && digits >= 0) return digits;
  if (typeof dto.is_3dp === 'boolean') return dto.is_3dp ? 3 : 2;
  return null;
}

/**
 * Maps a search hit or an asset-details payload. Returns null when the id or ticker is missing/invalid.
 * `options.sanitizeTicker` applies {@link sanitizeTicker} instead of rejecting non-conforming symbols.
 */
export function toInstrument(
  dto: AssetDto | null | undefined,
  fallbackMarket: Market,
  options: { sanitizeTicker?: boolean } = {},
): Instrument | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = parseAssetIdOrNull(dto.id);
  const ticker = options.sanitizeTicker ? sanitizeTicker(dto.symbol) : parseTickerOrNull(dto.symbol);
  if (!id || !ticker) return null;
  const symbolState = dto.stats?.symbol_state ?? dto.symbol_state;
  return Object.freeze({
    id,
    ticker,
    name: stringOrNull(dto.name) ?? ticker.value,
    assetClass: parseAssetClass(dto.asset_class),
    market: marketOrDefault(dto.market, fallbackMarket),
    currency: mapCurrency(dto.currency),
    sector: stringOrNull(dto.industry) ?? stringOrNull(dto.sector),
    board: stringOrNull(dto.feed?.market_id),
    tradable: booleanOrNull(dto.is_tradable),
    suspended: symbolState === 'S',
    priceDecimals: priceDecimals(dto),
    description: stringOrNull(dto.about),
    logoUrl: stringOrNull(dto.logo),
  });
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** Maps one marketwatch row (§1.3). Returns null when the asset id or ticker is missing/invalid. */
export function toQuote(dto: MarketwatchAssetDto | null | undefined): Quote | null {
  if (!dto || typeof dto !== 'object') return null;
  const instrumentId = parseAssetIdOrNull(dto.asset_id);
  const ticker = parseTickerOrNull(dto.reuters);
  if (!instrumentId || !ticker) return null;
  // ThndrX: `last_trade_price || close_price` (0 means "no trade yet today").
  const last = positiveOrNull(toNumber(dto.last_trade_price)) ?? toNumber(dto.close_price);
  const previousClose = toNumber(dto.previous_close);
  const listedShares = toNumber(dto.listed_shares);
  const change =
    toNumber(dto.last_change) ?? (last !== null && previousClose !== null ? last - previousClose : null);
  return Object.freeze({
    instrumentId,
    ticker,
    name: stringOrNull(dto.eng_name),
    sector: stringOrNull(dto.eng_desc),
    currency: mapCurrency(dto.currency),
    last,
    previousClose,
    open: toNumber(dto.open_price),
    high: toNumber(dto.high_price),
    low: toNumber(dto.low_price),
    change,
    changePercent: toNumber(dto.last_change_prc),
    bid: toNumber(dto.bid_price),
    bidSize: toNumber(dto.bid_volume),
    ask: toNumber(dto.ask_price),
    askSize: toNumber(dto.ask_volume),
    volume: toNumber(dto.total_volume),
    value: toNumber(dto.total_value),
    trades: toNumber(dto.total_trades),
    lowerLimit: toNumber(dto.low_price_limit) ?? toNumber(dto.min_limit),
    upperLimit: toNumber(dto.high_price_limit) ?? toNumber(dto.max_limit),
    week52High: toNumber(dto.high_52_week),
    week52Low: toNumber(dto.low_52_week),
    peRatio: toNumber(dto.pe_ratio),
    eps: toNumber(dto.eps),
    dividendYieldPercent: toNumber(dto.dividend_yield_perc),
    listedShares,
    marketCap: listedShares !== null && last !== null ? listedShares * last : null,
    averageVolume30d: toNumber(dto.avg_30_day),
    suspended: dto.symbol_state === 'S',
    lastTradeAt: parseTimestamp(dto.last_trade_date),
  });
}

/** Maps one market indicator (§8.2) to a sparse quote; non-conforming symbols are sanitised. */
export function indicatorToQuote(dto: MarketIndicatorDto | null | undefined): Quote | null {
  if (!dto || typeof dto !== 'object') return null;
  const instrumentId = parseAssetIdOrNull(dto.id);
  const ticker = sanitizeTicker(dto.symbol);
  if (!instrumentId || !ticker) return null;
  const feed = dto.feed ?? {};
  // ThndrX (lazy_2102): `last_trade_price` when > 0, else `price`.
  const last = positiveOrNull(toNumber(feed.last_trade_price)) ?? toNumber(feed.price);
  return Object.freeze({
    instrumentId,
    ticker,
    name: stringOrNull(dto.name),
    sector: null,
    currency: null,
    last,
    previousClose: toNumber(feed.previous_close),
    open: null,
    high: null,
    low: null,
    change: null,
    changePercent: toNumber(feed.last_change_prc),
    bid: null,
    bidSize: null,
    ask: null,
    askSize: null,
    volume: null,
    value: null,
    trades: null,
    lowerLimit: null,
    upperLimit: null,
    week52High: null,
    week52Low: null,
    peRatio: null,
    eps: null,
    dividendYieldPercent: null,
    listedShares: null,
    marketCap: null,
    averageVolume30d: null,
    suspended: false,
    lastTradeAt: null,
  });
}

/** Maps one OHLCV row (§2.2); malformed rows (missing values, high < low…) yield null. */
export function toCandle(dto: CandleDto | null | undefined): Candle | null {
  if (!dto || typeof dto !== 'object') return null;
  const time = parseTimestamp(dto.timestamp);
  const open = toNumber(dto.open);
  const high = toNumber(dto.high);
  const low = toNumber(dto.low);
  const close = toNumber(dto.close);
  const volume = toNumber(dto.volume);
  if (time === null || open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }
  try {
    return createCandle({ time, open, high, low, close, volume });
  } catch {
    return null;
  }
}

function toBookLevel(dto: DepthLevelDto | null | undefined): BookLevel | null {
  if (!dto || typeof dto !== 'object') return null;
  const price = toNumber(dto.order_price);
  const quantity = toNumber(dto.volume_traded);
  if (price === null || quantity === null) return null;
  return Object.freeze({ price, quantity, orders: toNumber(dto.split) });
}

function toBookLevels(rows: DepthLevelDto[] | null | undefined): BookLevel[] {
  return mapRows(rows, toBookLevel);
}

/** Maps market depth (§3.1): bids best (highest) first, asks best (lowest) first. */
export function toOrderBook(dto: MarketDepthResponseDto | null | undefined): OrderBook {
  const totals = dto?.total_bids_and_asks;
  return Object.freeze({
    bids: toBookLevels(dto?.bids_per_price).sort((a, b) => b.price - a.price),
    asks: toBookLevels(dto?.asks_per_price).sort((a, b) => a.price - b.price),
    totalBidQuantity: toNumber(totals?.total_bids),
    totalAskQuantity: toNumber(totals?.total_asks),
  });
}

function toTradeSide(raw: unknown): TradeSide {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return value === 'BUY' || value === 'SELL' ? value : 'UNKNOWN';
}

/** Maps one trades-book print (§3.2); rows without a cursor, price or volume yield null. */
export function toTapeTrade(dto: TradeDto | null | undefined): TapeTrade | null {
  if (!dto || typeof dto !== 'object') return null;
  const cursor = toStringOrNull(dto.cursor);
  const price = toNumber(dto.price);
  const quantity = toNumber(dto.volume);
  if (cursor === null || cursor === '' || price === null || quantity === null) return null;
  return Object.freeze({
    price,
    quantity,
    side: toTradeSide(dto.side),
    time: parseTimestamp(dto.time),
    cursor,
  });
}

/** Maps every row of a list, dropping the ones the row mapper rejects (null). */
export function mapRows<T, R>(rows: readonly T[] | null | undefined, map: (row: T) => R | null): R[] {
  if (!Array.isArray(rows)) return [];
  const out: R[] = [];
  for (const row of rows) {
    const mapped = map(row);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}
