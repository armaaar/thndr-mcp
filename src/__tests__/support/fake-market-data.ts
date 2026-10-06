import { NotFoundError } from '../../application/errors';
import type { MarketDataDependencies } from '../../application/market-data/dependencies';
import { IndexMembership } from '../../application/market-data/services/index-membership';
import { InstrumentResolver } from '../../application/market-data/services/instrument-resolver';
import { MarketQuotesCache } from '../../application/market-data/services/market-quotes-cache';
import type { Clock } from '../../application/ports/clock';
import type { Candle, CandleResolution } from '../../domain/market-data/candle';
import type { ClosePoint, CloseSpan } from '../../domain/market-data/close-series';
import type { Instrument, Quote } from '../../domain/market-data/instrument';
import type { LatestPrice } from '../../domain/market-data/latest-price';
import type { MarketSession, OrderBook, TapeTrade } from '../../domain/market-data/order-book';
import type { MarketDataRepository } from '../../domain/market-data/repository';
import type { Screener } from '../../domain/market-data/screener';
import { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import { Ticker } from '../../domain/shared-kernel/ticker';
import { FakeResearchRepository } from './fake-research';

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
    board: 'NOPL',
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
    averageVolume5d: 900_000,
    averageVolume90d: 700_000,
    // Consistent with `last` unless overridden (0 = nothing traded yet today).
    lastTradePrice: rest.last === undefined ? 100 : rest.last,
    lastTradeVolume: 10,
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

type LatestPriceOverrides = Partial<Omit<LatestPrice, 'instrumentId'>> & { id?: string; ticker?: string };

/** A bulk-price reading (defaults: NVDA-like US stock). */
export function aLatestPrice(overrides: LatestPriceOverrides = {}): LatestPrice {
  const { id, ticker = 'NVDA', ...rest } = overrides;
  return {
    instrumentId: AssetId.of(id ?? idFor(ticker)),
    last: 240.1,
    kind: 'close',
    at: new Date('2026-10-06T17:15:00Z'),
    open: 242.1,
    previousClose: 238.9,
    bid: null,
    ask: null,
    ...rest,
  };
}

/** Close points from `[ISO time, close]` pairs. */
export function closes(...points: Array<[string, number]>): ClosePoint[] {
  return points.map(([time, close]) => ({ time: new Date(time), close }));
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

/** In-memory MarketDataRepository: seed `instruments`, `quotes`… and inspect the recorded calls. */
export class FakeMarketDataRepository implements MarketDataRepository {
  instruments: Instrument[] = [];
  quotes: Partial<Record<Market, Quote[]>> = {};
  indicators: Partial<Record<Market, Quote[]>> = {};
  candles: Candle[] = [];
  /** Bulk latest prices, served for the ids asked. */
  latestPrices: LatestPrice[] = [];
  /** Close series per span (same series for every instrument). */
  closeSeries: Partial<Record<CloseSpan, ClosePoint[]>> = {};
  orderBook: OrderBook = anOrderBook();
  trades: TapeTrade[] = [];
  session: MarketSession = aMarketSession();
  /** Index asset id → member asset ids. */
  constituents: Record<string, string[]> = {};
  /** Instrument asset id → Thndr's "similar stocks". */
  similar: Record<string, Instrument[]> = {};
  /** The user's saved screeners. */
  screeners: Screener[] = [];
  /** When set, the named method rejects with this error. */
  failures: Partial<Record<keyof MarketDataRepository, Error>> = {};

  readonly calls = {
    searchInstruments: [] as Array<{ query: string; market: Market }>,
    getInstrument: [] as AssetId[],
    getMarketQuotes: [] as Market[],
    getCandles: [] as CandleCall[],
    getLatestPrices: [] as string[][],
    getCloses: [] as Array<{ id: AssetId; market: Market; span: CloseSpan }>,
    getOrderBook: [] as AssetId[],
    getRecentTrades: [] as Array<{ id: AssetId; limit: number; before?: string }>,
    getMarketSession: [] as Array<{ market: Market; board?: string | null }>,
    getMarketIndicators: [] as Market[],
    getIndexConstituents: [] as AssetId[],
    getSimilarInstruments: [] as Array<{ id: AssetId; market: Market; limit: number }>,
    getScreeners: [] as Market[],
    getScreener: [] as string[],
  };

  constructor(seed: Partial<Pick<FakeMarketDataRepository, 'instruments' | 'quotes'>> = {}) {
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

  async getLatestPrices(ids: readonly AssetId[]): Promise<LatestPrice[]> {
    this.calls.getLatestPrices.push(ids.map((id) => id.value));
    this.fail('getLatestPrices');
    return this.latestPrices.filter((p) => ids.some((id) => id.equals(p.instrumentId)));
  }

  async getCloses(id: AssetId, market: Market, span: CloseSpan): Promise<ClosePoint[]> {
    this.calls.getCloses.push({ id, market, span });
    this.fail('getCloses');
    return this.closeSeries[span] ?? [];
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

  async getIndexConstituents(indexId: AssetId): Promise<AssetId[]> {
    this.calls.getIndexConstituents.push(indexId);
    this.fail('getIndexConstituents');
    return (this.constituents[indexId.value] ?? []).map((id) => AssetId.of(id));
  }

  async getSimilarInstruments(id: AssetId, market: Market, limit: number): Promise<Instrument[]> {
    this.calls.getSimilarInstruments.push({ id, market, limit });
    this.fail('getSimilarInstruments');
    return (this.similar[id.value] ?? []).slice(0, limit);
  }

  async getScreeners(market: Market): Promise<Screener[]> {
    this.calls.getScreeners.push(market);
    this.fail('getScreeners');
    return this.screeners.filter((s) => s.market === null || s.market === market);
  }

  async getScreener(id: string): Promise<Screener> {
    this.calls.getScreener.push(id);
    this.fail('getScreener');
    const found = this.screeners.find((s) => s.id === id);
    if (!found) throw new NotFoundError(`No saved screener with id "${id}".`);
    return found;
  }

  private fail(method: keyof MarketDataRepository): void {
    const error = this.failures[method];
    if (error) throw error;
  }
}

/** Market Data use-case dependencies over fake repositories (real resolver and quotes cache). */
export function setupMarketData(
  repository = new FakeMarketDataRepository(),
  now: string | Date = '2026-01-15T12:00:00Z',
  research = new FakeResearchRepository(),
): MarketDataDependencies & { repository: FakeMarketDataRepository; research: FakeResearchRepository } {
  const clock = fixedClock(now);
  const quotes = new MarketQuotesCache(repository, clock);
  return {
    repository,
    research,
    clock,
    resolver: new InstrumentResolver(repository),
    quotes,
    indices: new IndexMembership(repository, quotes, clock),
  };
}

type ScreenerOverrides = Partial<Screener> & { id: string };

export function aScreener(overrides: ScreenerOverrides): Screener {
  return {
    name: `Screener ${overrides.id}`,
    market: 'egypt',
    preset: false,
    filters: [],
    unsupported: [],
    ...overrides,
  };
}

/** A US instrument (NVDA-like) for multi-market tests. */
export function aUsInstrument(overrides: InstrumentOverrides = {}): Instrument {
  return anInstrument({
    ticker: 'NVDA',
    name: 'NVIDIA Corporation Common Stock',
    market: 'us',
    currency: 'USD',
    sector: 'Semiconductors & Semiconductor Equipment',
    board: 'stocks',
    ...overrides,
  });
}

/** A fake repository listing one Egyptian instrument per ticker. */
export function withInstruments(...tickers: string[]): FakeMarketDataRepository {
  return new FakeMarketDataRepository({ instruments: tickers.map((ticker) => anInstrument({ ticker })) });
}
