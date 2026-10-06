import type { Currency } from '../shared-kernel/money';
import type { Ticker } from '../shared-kernel/ticker';
import type { AssetId } from './asset-id';
import type { AssetClass, Market } from './market';

/** A tradable (or reference) instrument listed on a market. */
export interface Instrument {
  readonly id: AssetId;
  readonly ticker: Ticker;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly market: Market;
  readonly currency: Currency | null;
  readonly sector: string | null;
  /** EGX board (`NOPL` main, `OOTC`, `SME`, `INDX`, `FNDS`…), when known. */
  readonly board: string | null;
  readonly tradable: boolean | null;
  readonly suspended: boolean;
  /** Price precision (EGX quotes have 2 or 3 decimals). */
  readonly priceDecimals: number | null;
  readonly description?: string | null;
  readonly logoUrl?: string | null;
}

/** The point-in-time trading snapshot of an instrument (one marketwatch row). */
export interface Quote {
  readonly instrumentId: AssetId;
  readonly ticker: Ticker;
  readonly name: string | null;
  readonly sector: string | null;
  readonly currency: Currency | null;
  readonly last: number | null;
  readonly previousClose: number | null;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly bid: number | null;
  readonly bidSize: number | null;
  readonly ask: number | null;
  readonly askSize: number | null;
  readonly volume: number | null;
  readonly value: number | null;
  readonly trades: number | null;
  /** Daily price band (circuit breaker limits). */
  readonly lowerLimit: number | null;
  readonly upperLimit: number | null;
  readonly week52High: number | null;
  readonly week52Low: number | null;
  readonly peRatio: number | null;
  readonly eps: number | null;
  readonly dividendYieldPercent: number | null;
  readonly listedShares: number | null;
  readonly marketCap: number | null;
  readonly averageVolume30d: number | null;
  readonly suspended: boolean;
  readonly lastTradeAt: Date | null;
}

/** Relative volume in percent of the 30-day average, as ThndrX computes it. */
export function relativeVolume(quote: Pick<Quote, 'volume' | 'averageVolume30d'>): number | null {
  if (quote.volume === null || !quote.averageVolume30d) return null;
  return (quote.volume / quote.averageVolume30d) * 100;
}
