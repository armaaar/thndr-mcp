import { describe, expect, it } from 'vitest';
import { InstrumentResolver } from '../../../src/application/market-data/instrument-resolver.js';
import { MarketQuotesCache } from '../../../src/application/market-data/quote-cache.js';
import {
  GetInstrumentDetails,
  GetMarketDepth,
  GetMarketStatus,
  GetPriceHistory,
  GetPriceSnapshot,
  GetRecentTrades,
  type MarketDataDependencies,
  ScreenMarket,
  SearchInstruments,
} from '../../../src/application/market-data/use-cases.js';
import { MAX_HISTORY_MS } from '../../../src/domain/market-data/candle.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';
import {
  aCandle,
  anInstrument,
  anOrderBook,
  aQuote,
  aTapeTrade,
  COMI_ID,
  FakeMarketDataGateway,
  fixedClock,
} from '../../support/fake-market-data.js';

const NOW = new Date('2026-01-15T12:00:00Z');

function setup(
  gateway = new FakeMarketDataGateway(),
): MarketDataDependencies & { gateway: FakeMarketDataGateway } {
  const clock = fixedClock(NOW);
  return {
    gateway,
    clock,
    resolver: new InstrumentResolver(gateway),
    quotes: new MarketQuotesCache(gateway, clock),
  };
}

function withInstruments(...tickers: string[]) {
  return new FakeMarketDataGateway({ instruments: tickers.map((ticker) => anInstrument({ ticker })) });
}

describe('SearchInstruments', () => {
  it('searches the parsed market, seeds the resolver and limits results', async () => {
    const deps = setup(withInstruments(...Array.from({ length: 60 }, (_, i) => `CO${i}`)));
    const out = await new SearchInstruments(deps).execute({ query: ' co ', market: 'EGX' });
    expect(deps.gateway.calls.searchInstruments).toEqual([{ query: 'co', market: 'egypt' }]);
    expect(out).toHaveLength(20);
    await deps.resolver.resolve('CO59', 'egypt');
    expect(deps.gateway.calls.searchInstruments).toHaveLength(1);
  });

  it('clamps the limit between 1 and 50', async () => {
    const deps = setup(withInstruments(...Array.from({ length: 60 }, (_, i) => `CO${i}`)));
    const uc = new SearchInstruments(deps);
    expect(await uc.execute({ query: 'CO', limit: 0 })).toHaveLength(1);
    expect(await uc.execute({ query: 'CO', limit: 500 })).toHaveLength(50);
  });

  it('rejects an empty query', async () => {
    await expect(new SearchInstruments(setup()).execute({ query: '  ' })).rejects.toThrow(ValidationError);
  });
});

describe('GetInstrumentDetails', () => {
  it('resolves the symbol then loads the full details', async () => {
    const deps = setup(withInstruments('COMI'));
    const out = await new GetInstrumentDetails(deps).execute({ symbol: 'comi' });
    expect(out.ticker.value).toBe('COMI');
    expect(deps.gateway.calls.getInstrument.map((id) => id.value)).toEqual([COMI_ID]);
  });
});

describe('GetPriceSnapshot', () => {
  it('returns quotes in request order and reports instruments without a quote', async () => {
    const gateway = withInstruments('COMI', 'HRHO', 'ETEL');
    gateway.quotes.egypt = [aQuote({ ticker: 'ETEL' }), aQuote({ ticker: 'COMI' })];
    const out = await new GetPriceSnapshot(setup(gateway)).execute({ symbols: ['COMI', 'HRHO', 'ETEL'] });
    expect(out.quotes.map((q) => q.ticker.value)).toEqual(['COMI', 'ETEL']);
    expect(out.missing).toEqual(['HRHO']);
  });

  it('validates the number of symbols', async () => {
    const uc = new GetPriceSnapshot(setup());
    await expect(uc.execute({ symbols: [] })).rejects.toThrow('Provide at least one symbol');
    await expect(uc.execute({ symbols: Array.from({ length: 51 }, () => 'COMI') })).rejects.toThrow(
      'At most 50 symbols per request',
    );
  });
});

describe('GetPriceHistory', () => {
  const candlesAt = (...hours: number[]) =>
    hours.map((h) => aCandle({ time: new Date(Date.UTC(2026, 0, 15, h)), close: h }));

  it('over-fetches 4x for intraday bars, sorts and trims to the requested bar count', async () => {
    const deps = setup(withInstruments('COMI'));
    deps.gateway.candles = candlesAt(11, 9, 10);
    const out = await new GetPriceHistory(deps).execute({ symbol: 'COMI', resolution: '1h', bars: 2 });
    const call = deps.gateway.calls.getCandles[0]!;
    expect(call.resolution).toBe('1h');
    expect(call.id.value).toBe(COMI_ID);
    expect(call.to).toEqual(NOW);
    expect(call.from).toEqual(new Date(NOW.getTime() - 2 * 3_600_000 * 4));
    expect(out).toMatchObject({
      ticker: 'COMI',
      resolution: '1h',
      from: call.from.toISOString(),
      to: NOW.toISOString(),
    });
    expect(out.candles.map((c) => c.close)).toEqual([10, 11]);
  });

  it('uses a 1.6x window for daily bars and the default of 100 bars', async () => {
    const deps = setup(withInstruments('COMI'));
    await new GetPriceHistory(deps).execute({ symbol: 'COMI', resolution: '1d' });
    expect(deps.gateway.calls.getCandles[0]!.from).toEqual(new Date(NOW.getTime() - 100 * 86_400_000 * 1.6));
  });

  it('uses 4x for minute bars and clamps bars to [1, 2000] and to 5 years', async () => {
    const deps = setup(withInstruments('COMI'));
    const uc = new GetPriceHistory(deps);
    await uc.execute({ symbol: 'COMI', resolution: '5min', bars: 0 });
    expect(deps.gateway.calls.getCandles[0]!.from).toEqual(new Date(NOW.getTime() - 300_000 * 4));
    await uc.execute({ symbol: 'COMI', resolution: '1w', bars: 10_000 });
    expect(deps.gateway.calls.getCandles[1]!.from).toEqual(new Date(NOW.getTime() - MAX_HISTORY_MS));
  });

  it('returns every candle in an explicit window', async () => {
    const deps = setup(withInstruments('COMI'));
    deps.gateway.candles = candlesAt(10, 9, 11);
    const from = new Date('2026-01-15T00:00:00Z');
    const to = new Date('2026-01-15T11:30:00Z');
    const out = await new GetPriceHistory(deps).execute({
      symbol: 'COMI',
      resolution: '1h',
      from,
      to,
      bars: 1,
    });
    expect(deps.gateway.calls.getCandles[0]).toMatchObject({ from, to });
    expect(out.candles.map((c) => c.close)).toEqual([9, 10, 11]);
  });

  it('derives "from" from an explicit "to"', async () => {
    const deps = setup(withInstruments('COMI'));
    const to = new Date('2026-01-10T00:00:00Z');
    await new GetPriceHistory(deps).execute({ symbol: 'COMI', resolution: '1d', to, bars: 10 });
    expect(deps.gateway.calls.getCandles[0]).toMatchObject({
      from: new Date(to.getTime() - 16 * 86_400_000),
      to,
    });
  });
});

describe('GetMarketDepth', () => {
  it('trims levels (default 10) and computes the spread from the full book', async () => {
    const deps = setup(withInstruments('COMI'));
    const levels = (start: number, step: number) =>
      Array.from({ length: 12 }, (_, i) => ({ price: start + i * step, quantity: 1, orders: null }));
    deps.gateway.orderBook = anOrderBook({ bids: levels(99, -0.1), asks: levels(101, 0.1) });
    const out = await new GetMarketDepth(deps).execute({ symbol: 'COMI' });
    expect(out.ticker).toBe('COMI');
    expect(out.bids).toHaveLength(10);
    expect(out.asks).toHaveLength(10);
    expect(out.totalBidQuantity).toBe(300);
    expect(out.spread).toEqual({ absolute: 2, percent: 2 });
    expect(deps.gateway.calls.getOrderBook.map((id) => id.value)).toEqual([COMI_ID]);
  });

  it('clamps levels between 1 and 50', async () => {
    const deps = setup(withInstruments('COMI'));
    const uc = new GetMarketDepth(deps);
    expect((await uc.execute({ symbol: 'COMI', levels: 0 })).bids).toHaveLength(1);
    expect((await uc.execute({ symbol: 'COMI', levels: 99 })).bids).toHaveLength(2);
  });
});

describe('GetRecentTrades', () => {
  it('passes limit and cursor through and exposes the next cursor', async () => {
    const deps = setup(withInstruments('COMI'));
    deps.gateway.trades = [aTapeTrade({ cursor: '9' }), aTapeTrade({ cursor: '8' })];
    const out = await new GetRecentTrades(deps).execute({ symbol: 'COMI', limit: 500, before: '10' });
    expect(out).toMatchObject({ ticker: 'COMI', nextCursor: '8' });
    expect(out.trades).toHaveLength(2);
    expect(deps.gateway.calls.getRecentTrades[0]).toMatchObject({ limit: 200, before: '10' });
  });

  it('defaults to 50, clamps to at least 1 and has no cursor when empty', async () => {
    const deps = setup(withInstruments('COMI'));
    const uc = new GetRecentTrades(deps);
    expect((await uc.execute({ symbol: 'COMI' })).nextCursor).toBeNull();
    await uc.execute({ symbol: 'COMI', limit: -5 });
    expect(deps.gateway.calls.getRecentTrades.map((c) => c.limit)).toEqual([50, 1]);
  });
});

describe('GetMarketStatus', () => {
  it('combines the session with index levels', async () => {
    const deps = setup();
    deps.gateway.indicators.egypt = [
      aQuote({ ticker: 'EGX30', last: 30_000, changePercent: 1.5, previousClose: 29_556 }),
    ];
    const out = await new GetMarketStatus(deps).execute({});
    expect(out).toMatchObject({ market: 'egypt', isOpen: true });
    expect(out.indices).toEqual([
      { ticker: 'EGX30', level: 30_000, changePercent: 1.5, previousClose: 29_556 },
    ]);
    expect(deps.gateway.calls.getMarketSession).toEqual([{ market: 'egypt', board: undefined }]);
  });

  it('still answers when indicators fail', async () => {
    const deps = setup();
    deps.gateway.failures.getMarketIndicators = new Error('down');
    const out = await new GetMarketStatus(deps).execute({ market: 'us' });
    expect(out).toMatchObject({ market: 'us', indices: [] });
  });
});

describe('ScreenMarket', () => {
  const quotes = [
    aQuote({
      ticker: 'AAA',
      sector: 'Banks',
      last: 10,
      changePercent: 5,
      value: 1000,
      volume: 300,
      averageVolume30d: 100,
      peRatio: 5,
      dividendYieldPercent: 4,
      marketCap: 50,
    }),
    aQuote({
      ticker: 'BBB',
      sector: 'Real Estate',
      last: 20,
      changePercent: -3,
      value: 5000,
      volume: 50,
      averageVolume30d: 100,
      peRatio: 20,
      dividendYieldPercent: 0,
      marketCap: 80,
    }),
    aQuote({
      ticker: 'CCC',
      sector: null,
      last: 30,
      changePercent: null,
      value: null,
      volume: null,
      averageVolume30d: null,
      peRatio: null,
      dividendYieldPercent: null,
      marketCap: null,
    }),
    aQuote({ ticker: 'SUSP', sector: 'Banks', last: 5, changePercent: 9, peRatio: null, suspended: true }),
  ];

  function screen(criteria: Parameters<ScreenMarket['execute']>[0]) {
    const gateway = new FakeMarketDataGateway({ quotes: { egypt: quotes } });
    return new ScreenMarket(setup(gateway)).execute(criteria);
  }
  const tickers = (out: Awaited<ReturnType<typeof screen>>) => out.results.map((r) => r.ticker.value);

  it('defaults to changePercent desc, excludes suspended, puts nulls last and adds relative volume', async () => {
    const out = await screen({});
    expect(out.market).toBe('egypt');
    expect(out.total).toBe(3);
    expect(tickers(out)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(out.results[0]!.relativeVolume).toBe(300);
    expect(out.results[2]!.relativeVolume).toBeNull();
  });

  it('includes suspended rows on request and sorts ascending', async () => {
    const out = await screen({ includeSuspended: true, order: 'asc', sortBy: 'last' });
    expect(tickers(out)).toEqual(['SUSP', 'AAA', 'BBB', 'CCC']);
  });

  it('sorts rows after a null value ahead of it', async () => {
    expect(tickers(await screen({ includeSuspended: true }))).toEqual(['SUSP', 'AAA', 'BBB', 'CCC']);
  });

  it('keeps null-vs-null order stable', async () => {
    const out = await screen({ sortBy: 'peRatio', includeSuspended: true });
    expect(tickers(out)).toEqual(['BBB', 'AAA', 'CCC', 'SUSP']);
  });

  it('filters by sector (substring, case-insensitive)', async () => {
    expect(tickers(await screen({ sector: ' bank ' }))).toEqual(['AAA']);
  });

  it('applies numeric bounds and drops rows with missing values', async () => {
    expect(tickers(await screen({ minPrice: 15, maxPrice: 25 }))).toEqual(['BBB']);
    expect(tickers(await screen({ minChangePercent: 0 }))).toEqual(['AAA']);
    expect(tickers(await screen({ maxChangePercent: 0 }))).toEqual(['BBB']);
    expect(tickers(await screen({ minValue: 2000 }))).toEqual(['BBB']);
    expect(tickers(await screen({ minRelativeVolume: 100 }))).toEqual(['AAA']);
    expect(tickers(await screen({ maxPeRatio: 10 }))).toEqual(['AAA']);
    expect(tickers(await screen({ minDividendYield: 1 }))).toEqual(['AAA']);
  });

  it('sorts by any field and clamps the limit', async () => {
    expect(tickers(await screen({ sortBy: 'marketCap', limit: 1 }))).toEqual(['BBB']);
    expect(tickers(await screen({ sortBy: 'relativeVolume', limit: 0 }))).toEqual(['AAA']);
    expect((await screen({ limit: 1000 })).results).toHaveLength(3);
  });
});
