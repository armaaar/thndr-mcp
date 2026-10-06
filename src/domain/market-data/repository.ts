import type { AssetId } from './asset-id.js';
import type { Candle, CandleResolution } from './candle.js';
import type { Instrument, Quote } from './instrument.js';
import type { Market } from './market.js';
import type { MarketSession, OrderBook, TapeTrade } from './order-book.js';

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
}
