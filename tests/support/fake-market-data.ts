import type { Clock } from '../../src/application/ports/clock.js';
import type { MarketDataGateway } from '../../src/application/ports/market-data.js';
import { AssetId } from '../../src/domain/market-data/asset-id.js';
import type { Candle, CandleResolution } from '../../src/domain/market-data/candle.js';
import type { Instrument, Quote } from '../../src/domain/market-data/instrument.js';
import type { Market } from '../../src/domain/market-data/market.js';
import type { MarketSession, OrderBook, TapeTrade } from '../../src/domain/market-data/order-book.js';
import { Ticker } from '../../src/domain/shared/ticker.js';

/** COMI's real Thndr asset id (docs/api/market-data.md §0.4). */
export const COMI_ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';

/** Deterministic UUID derived from a ticker, so builders produce stable ids. */
export function idFor(ticker: string): string {
  if (ticker.toUpperCase() === 'COMI') return COMI_ID;
  let hash = 0;
  for (const char of ticker.toUpperCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hex = hash.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${hex.padStart(12, '0')}`;
}

type InstrumentOverrides = Partial<Omit<Instrument, 'id' | 'ticker'>> & { id?: string; ticker?: string };

export function anInstrument(overrides: InstrumentOverrides = {}): Instrument {
  const { id, ticker = 'COMI', ...rest } = overrides;
  return {
    id: AssetId.of(id ?? idFor(ticker)),
    ticker: Ticker.of(ticker),
    name: `${ticker} Corp`,
    assetClass: 'STOCK',
    market: 'egypt',
    currency: 'EGP',
    sector: 'Banks',
    board: 'NOPL',
    tradable: true,
    suspended: false,
    priceDecimals: 2,
    ...rest,
  };
}

type QuoteOverrides = Partial<Omit<Quote, 'instrumentId' | 'ticker'>> & { id?: string; ticker?: string };

export function aQuote(overrides: QuoteOverrides = {}): Quote {
  const { id, ticker = 'COMI', ...rest } = overrides;
  return {
    instrumentId: AssetId.of(id ?? idFor(ticker)),
    ticker: Ticker.of(ticker),
    name: `${ticker} Corp`,
    sector: 'Banks',
    currency: 'EGP',
    last: 100,
    previousClose: 98,
    open: 99,
    high: 101,
    low: 97,
    change: 2,
    changePercent: 2.04,
    bid: 99.9,
    bidSize: 1000,
    ask: 100.1,
    askSize: 500,
    volume: 1_000_000,
    value: 100_000_000,
    trades: 2500,
    lowerLimit: 88.2,
    upperLimit: 107.8,
    week52High: 120,
    week52Low: 70,
    peRatio: 8,
    eps: 12.5,
    dividendYieldPercent: 3,
    listedShares: 3_000_000_000,
    marketCap: 300_000_000_000,
    averageVolume30d: 800_000,
    suspended: false,
    lastTradeAt: new Date('2026-01-01T12:00:00Z'),
    ...rest,
  };
}

export function aCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    time: new Date('2026-01-01T10:00:00Z'),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1000,
    ...overrides,
  };
}

export function anOrderBook(overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    bids: [
      { price: 99.9, quantity: 100, orders: 2 },
      { price: 99.8, quantity: 200, orders: 3 },
    ],
    asks: [
      { price: 100.1, quantity: 150, orders: 1 },
      { price: 100.2, quantity: 50, orders: null },
    ],
    totalBidQuantity: 300,
    totalAskQuantity: 200,
    ...overrides,
  };
}

export function aTapeTrade(overrides: Partial<TapeTrade> = {}): TapeTrade {
  return {
    price: 100,
    quantity: 10,
    side: 'BUY',
    time: new Date('2026-01-01T10:00:00Z'),
    cursor: '1',
    ...overrides,
  };
}

export function aMarketSession(overrides: Partial<MarketSession> = {}): MarketSession {
  return {
    market: 'egypt',
    isOpen: true,
    opensAt: new Date('2026-01-01T08:00:00Z'),
    closesAt: new Date('2026-01-01T12:30:00Z'),
    ...overrides,
  };
}

export function fixedClock(at: string | Date = '2026-01-01T12:00:00Z'): Clock {
  const time = new Date(at).getTime();
  return { now: () => new Date(time) };
}

export interface CandleCall {
  id: AssetId;
  resolution: CandleResolution;
  from: Date;
  to: Date;
}

/** In-memory MarketDataGateway: seed `instruments`, `quotes`… and inspect the recorded calls. */
export class FakeMarketDataGateway implements MarketDataGateway {
  instruments: Instrument[] = [];
  quotes: Partial<Record<Market, Quote[]>> = {};
  indicators: Partial<Record<Market, Quote[]>> = {};
  candles: Candle[] = [];
  orderBook: OrderBook = anOrderBook();
  trades: TapeTrade[] = [];
  session: MarketSession = aMarketSession();
  /** When set, the named method rejects with this error. */
  failures: Partial<Record<keyof MarketDataGateway, Error>> = {};

  readonly calls = {
    searchInstruments: [] as Array<{ query: string; market: Market }>,
    getInstrument: [] as AssetId[],
    getMarketQuotes: [] as Market[],
    getCandles: [] as CandleCall[],
    getOrderBook: [] as AssetId[],
    getRecentTrades: [] as Array<{ id: AssetId; limit: number; before?: string }>,
    getMarketSession: [] as Array<{ market: Market; board?: string | null }>,
    getMarketIndicators: [] as Market[],
  };

  constructor(seed: Partial<Pick<FakeMarketDataGateway, 'instruments' | 'quotes'>> = {}) {
    Object.assign(this, seed);
  }

  async searchInstruments(query: string, market: Market): Promise<Instrument[]> {
    this.calls.searchInstruments.push({ query, market });
    this.fail('searchInstruments');
    const q = query.toUpperCase();
    return this.instruments.filter(
      (i) => i.market === market && (i.ticker.value.includes(q) || i.name.toUpperCase().includes(q)),
    );
  }

  async getInstrument(id: AssetId): Promise<Instrument> {
    this.calls.getInstrument.push(id);
    this.fail('getInstrument');
    const found = this.instruments.find((i) => i.id.equals(id));
    if (!found) throw new Error(`fake: no instrument ${id.value}`);
    return found;
  }

  async getMarketQuotes(market: Market): Promise<Quote[]> {
    this.calls.getMarketQuotes.push(market);
    this.fail('getMarketQuotes');
    return this.quotes[market] ?? [];
  }

  async getCandles(id: AssetId, resolution: CandleResolution, from: Date, to: Date): Promise<Candle[]> {
    this.calls.getCandles.push({ id, resolution, from, to });
    this.fail('getCandles');
    return this.candles;
  }

  async getOrderBook(id: AssetId): Promise<OrderBook> {
    this.calls.getOrderBook.push(id);
    this.fail('getOrderBook');
    return this.orderBook;
  }

  async getRecentTrades(id: AssetId, limit: number, before?: string): Promise<TapeTrade[]> {
    this.calls.getRecentTrades.push({ id, limit, before });
    this.fail('getRecentTrades');
    return this.trades;
  }

  async getMarketSession(market: Market, board?: string | null): Promise<MarketSession> {
    this.calls.getMarketSession.push({ market, board });
    this.fail('getMarketSession');
    return { ...this.session, market };
  }

  async getMarketIndicators(market: Market): Promise<Quote[]> {
    this.calls.getMarketIndicators.push(market);
    this.fail('getMarketIndicators');
    return this.indicators[market] ?? [];
  }

  private fail(method: keyof MarketDataGateway): void {
    const error = this.failures[method];
    if (error) throw error;
  }
}
