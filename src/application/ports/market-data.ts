import type { AssetId } from '../../domain/market-data/asset-id.js';
import type { Candle, CandleResolution } from '../../domain/market-data/candle.js';
import type { Instrument, Quote } from '../../domain/market-data/instrument.js';
import type { Market } from '../../domain/market-data/market.js';
import type { MarketSession, OrderBook, TapeTrade } from '../../domain/market-data/order-book.js';

export interface MarketDataGateway {
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
