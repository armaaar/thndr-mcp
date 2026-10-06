import type { AssetId } from '../shared-kernel/asset-id';
import type { Market } from '../shared-kernel/market';
import type { Candle, CandleResolution } from './candle';
import type { ClosePoint, CloseSpan } from './close-series';
import type { Instrument, Quote } from './instrument';
import type { LatestPrice } from './latest-price';
import type { MarketSession, OrderBook, TapeTrade } from './order-book';
import type { Screener } from './screener';

export interface MarketDataRepository {
  searchInstruments(query: string, market: Market): Promise<Instrument[]>;
  getInstrument(id: AssetId): Promise<Instrument>;
  /** Snapshot of every instrument of a market (ThndrX "marketwatch"). */
  getMarketQuotes(market: Market): Promise<Quote[]>;
  /** OHLCV candles (Egypt only: empty for US/UAE instruments). */
  getCandles(id: AssetId, resolution: CandleResolution, from: Date, to: Date): Promise<Candle[]>;
  /** Latest prices of instruments of any market, in one call; instruments Thndr has no price for are absent. */
  getLatestPrices(ids: readonly AssetId[]): Promise<LatestPrice[]>;
  /** Closing prices over a trailing span, oldest first (every market); `market` is the instrument's own market. */
  getCloses(id: AssetId, market: Market, span: CloseSpan): Promise<ClosePoint[]>;
  getOrderBook(id: AssetId): Promise<OrderBook>;
  getRecentTrades(id: AssetId, limit: number, before?: string): Promise<TapeTrade[]>;
  getMarketSession(market: Market, board?: string | null): Promise<MarketSession>;
  /** Index levels (EGX30, EGX70…) and reference rates. */
  getMarketIndicators(market: Market): Promise<Quote[]>;
  /** Member instruments of an index (an `INDX` instrument such as EGX30); empty for anything else. */
  getIndexConstituents(indexId: AssetId): Promise<AssetId[]>;
  /** Thndr's "similar stocks" for an instrument, at most `limit`. */
  getSimilarInstruments(id: AssetId, market: Market, limit: number): Promise<Instrument[]>;
  /** The user's saved screeners of a market. */
  getScreeners(market: Market): Promise<Screener[]>;
  /** One saved screener; `NOT_FOUND` when it does not exist. */
  getScreener(id: string): Promise<Screener>;
}
