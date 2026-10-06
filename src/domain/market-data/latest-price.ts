import type { AssetId } from '../shared-kernel/asset-id';
import { roundTo } from '../shared-kernel/guards';
import type { Instrument, Quote } from './instrument';

/** What the latest price of an instrument is: a trade, a close, a fund's NAV or a reference rate. */
export type LatestPriceKind = 'trade' | 'close' | 'nav' | 'rate' | 'unknown';

/**
 * The latest price of one instrument from Thndr's bulk price service (every market, ADR 0021). It is much thinner than
 * Egypt's marketwatch row: no high/low, volume, value, limits or ratios.
 */
export interface LatestPrice {
  readonly instrumentId: AssetId;
  readonly last: number | null;
  readonly kind: LatestPriceKind;
  /** Time of `last` as Thndr reports it. */
  readonly at: Date | null;
  readonly open: number | null;
  readonly previousClose: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
}

/**
 * A quote from an instrument's listing and its latest price (pure): last, open, previous close, change and change % from
 * the previous close, bid/ask when Thndr has them; every field the price service lacks is null.
 */
export function quoteFromLatestPrice(instrument: Instrument, price: LatestPrice): Quote {
  const { last, previousClose } = price;
  const change = last !== null && previousClose !== null ? roundTo(last - previousClose, 6) : null;
  const changePercent =
    change !== null && previousClose !== null && previousClose > 0
      ? roundTo((change / previousClose) * 100, 4)
      : null;
  return Object.freeze({
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    name: instrument.name,
    sector: instrument.sector,
    board: instrument.board,
    currency: instrument.currency,
    last,
    previousClose,
    open: price.open,
    high: null,
    low: null,
    change,
    changePercent,
    bid: price.bid,
    bidSize: null,
    ask: price.ask,
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
    averageVolume5d: null,
    averageVolume90d: null,
    lastTradePrice: price.kind === 'trade' ? last : null,
    lastTradeVolume: null,
    suspended: instrument.suspended,
    lastTradeAt: price.at,
  });
}
