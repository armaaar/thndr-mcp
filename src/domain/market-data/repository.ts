import type { AssetId } from '../shared-kernel/asset-id';
import type { Market } from '../shared-kernel/market';
import type { Candle, CandleResolution } from './candle';
import type { Instrument, Quote } from './instrument';
import type { MarketSession, OrderBook, TapeTrade } from './order-book';

export interface MarketDataRepository {
  searchInstruments(query: string, market: Market): Promise<Instrument[]>;
  getInstrument(id: AssetId): Promise<Instrument>;
  /** Snapshot of every instrument of a market (ThndrX "marketwatch"). */
  getMarketQuotes(market: Market): Promise<Quote[]>;
  getCandles(id: AssetId, resolution: CandleResolution, from: Date, to: Date): Promise<Candle[]>;
  getOrderBook(id: AssetId): Promise<OrderBook>;
  getRecentTrades(id: AssetId, limit: number, before?: string): Promise<TapeTrade[]>;
  getMarketSession(market: Market, board?: string | null): Promise<MarketSession>;
  /** Index levels (EGX30, EGX70…) and reference rates. */
  getMarketIndicators(market: Market): Promise<Quote[]>;
  /** Member instruments of an index (an `INDX` instrument such as EGX30); empty for anything else. */
  getIndexConstituents(indexId: AssetId): Promise<AssetId[]>;
}
