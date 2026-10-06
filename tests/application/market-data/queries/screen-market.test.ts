import { describe, expect, it } from 'vitest';
import { ScreenMarket } from '../../../../src/application/market-data/queries/screen-market';
import { aQuote, FakeMarketDataRepository, setupMarketData } from '../../../support/fake-market-data';

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

function setup() {
  return setupMarketData(new FakeMarketDataRepository({ quotes: { egypt: quotes, us: [] } }));
}

function screen(criteria: Record<string, unknown>) {
  return new ScreenMarket(setup()).run(criteria);
}
const tickers = (out: Awaited<ReturnType<typeof screen>>) => out.results.map((r) => r.ticker.value);

describe('ScreenMarket', () => {
  it('declares its contract', async () => {
    const uc = new ScreenMarket(setup());
    expect(uc).toMatchObject({ name: 'screen_market', kind: 'query', context: 'market-data' });
    const invalid = [
      { sortBy: 'name' },
      { order: 'up' },
      { limit: 0 },
      { limit: 101 },
      { min_relative_volume: 200 },
      { minPrice: '10' },
      { market: 'mars' },
    ];
    for (const input of invalid) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('defaults via run() to changePercent desc, excludes suspended, puts nulls last and adds relative volume', async () => {
    const out = await screen({});
    expect(out.market).toBe('egypt');
    expect(out.total).toBe(3);
    expect(tickers(out)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(out.results[0]!.relativeVolume).toBe(300);
    expect(out.results[2]!.relativeVolume).toBeNull();
  });

  it('screens the requested market', async () => {
    const deps = setup();
    expect(await new ScreenMarket(deps).run({ market: 'us' })).toEqual({
      market: 'us',
      total: 0,
      results: [],
    });
    expect(deps.repository.calls.getMarketQuotes).toEqual(['us']);
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
    expect(tickers(await screen({ sector: '   ' }))).toEqual(['AAA', 'BBB', 'CCC']);
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

  it('sorts by any field and limits the results', async () => {
    expect(tickers(await screen({ sortBy: 'marketCap', limit: 1 }))).toEqual(['BBB']);
    expect(tickers(await screen({ sortBy: 'relativeVolume', limit: 1 }))).toEqual(['AAA']);
    expect((await screen({ limit: 100 })).results).toHaveLength(3);
  });

  it('defaults and clamps sort and limit when executed directly', async () => {
    const uc = new ScreenMarket(setup());
    expect(tickers(await uc.execute({}))).toEqual(['AAA', 'BBB', 'CCC']);
    expect(tickers(await uc.execute({ limit: 0 }))).toEqual(['AAA']);
    expect((await uc.execute({ limit: 1000 })).results).toHaveLength(3);
  });
});
