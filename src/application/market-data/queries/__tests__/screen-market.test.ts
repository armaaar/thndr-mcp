import { describe, expect, it } from 'vitest';
import {
  aQuote,
  aScreener,
  FakeMarketDataRepository,
  idFor,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { ScreenMarket } from '../screen-market';

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
      { preset: 'moon-shots' },
      { screenerId: '' },
      { index: '' },
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

  it('refuses markets without a whole-market snapshot before calling Thndr', async () => {
    const deps = setup();
    for (const market of ['us', 'uae', 'simulator']) {
      await expect(new ScreenMarket(deps).run({ market })).rejects.toMatchObject({
        code: 'FEATURE_DISABLED',
      });
    }
    expect(deps.repository.calls.getMarketQuotes).toEqual([]);
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

  describe('index rows, index membership, presets and saved screeners', () => {
    const egx30 = aQuote({
      ticker: 'EGX30',
      board: 'INDX',
      sector: null,
      last: 30_000,
      changePercent: 9,
      value: 1e12,
      volume: 1e9,
      peRatio: 0,
      marketCap: null,
    });
    // A momentum mover: value 2M, relative volume 200, 5 % under its 52-week high, up 5.6 %.
    const mover = aQuote({
      ticker: 'MOVE',
      sector: 'Real Estate',
      last: 95,
      previousClose: 90,
      changePercent: 5.56,
      value: 2_000_000,
      volume: 200,
      averageVolume30d: 100,
      week52High: 100,
      dividendYieldPercent: 1,
    });
    const laggard = aQuote({
      ticker: 'LAG',
      last: 50,
      previousClose: 51,
      changePercent: -1.96,
      week52High: 100,
    });

    function deps() {
      const repository = new FakeMarketDataRepository({
        quotes: { egypt: [egx30, mover, laggard, ...quotes] },
      });
      repository.constituents = { [idFor('EGX30')]: [idFor('MOVE'), idFor('AAA')] };
      repository.screeners = [
        aScreener({
          id: 's1',
          name: 'Cheap',
          filters: [{ field: 'price', condition: { kind: 'between', min: null, max: 60 } }],
        }),
        aScreener({ id: 'bad', name: 'Odd', unsupported: ['filter key "ref_price" is not supported'] }),
        aScreener({ id: 'us1', name: 'US picks', market: 'us' }),
      ];
      return setupMarketData(repository);
    }
    const run = (criteria: Record<string, unknown>) => new ScreenMarket(deps()).run(criteria);

    it('never returns index rows, even with the largest value and volume or a 0 P/E', async () => {
      expect(tickers(await run({ sortBy: 'value', limit: 1 }))).toEqual(['LAG']);
      expect(tickers(await run({ sortBy: 'volume', limit: 1 }))).not.toContain('EGX30');
      expect(tickers(await run({ maxPeRatio: 1, includeSuspended: true }))).toEqual([]);
      expect((await run({ limit: 100 })).results.map((r) => r.board)).not.toContain('INDX');
    });

    it('screens the members of an index only', async () => {
      const out = await run({ index: 'egx30' });
      expect(out.index).toBe('EGX30');
      expect(tickers(out)).toEqual(['MOVE', 'AAA']);
      await expect(run({ index: 'NOPE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("applies a ThndrX preset with ThndrX's rules and reports its filters", async () => {
      const out = await run({ preset: 'momentum-movers' });
      expect(tickers(out)).toEqual(['MOVE']);
      expect(out.screeners).toEqual([
        {
          id: 'momentum-movers',
          name: 'Momentum Movers',
          filters: [
            'value ≥ 1,000,000',
            'relativeVolume ≥ 100',
            'week52HighDistance ≤ 10',
            'changePercent ≥ 2',
          ],
        },
      ]);
      expect(out.index).toBeUndefined();
    });

    it('applies a saved screener and combines everything with AND', async () => {
      const d = deps();
      const saved = await new ScreenMarket(d).run({ screenerId: 's1' });
      expect(d.repository.calls.getScreener).toEqual(['s1']);
      expect(tickers(saved)).toEqual(['AAA', 'LAG', 'BBB', 'CCC']);
      expect(saved.screeners).toEqual([{ id: 's1', name: 'Cheap', filters: ['price ≤ 60'] }]);
      expect(tickers(await run({ screenerId: 's1', index: 'EGX30' }))).toEqual(['AAA']);
      expect(tickers(await run({ screenerId: 's1', sector: 'bank' }))).toEqual(['AAA', 'LAG']);
      expect(tickers(await run({ screenerId: 's1', preset: 'momentum-movers' }))).toEqual([]);
      expect((await run({ screenerId: 's1', preset: 'reversal-watch' })).screeners?.map((x) => x.id)).toEqual(
        ['reversal-watch', 's1'],
      );
      await expect(run({ screenerId: 'us1' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Screener "US picks" was saved for the us market; run it with market "us".',
      });
    });

    it('refuses a saved screener with filters it cannot evaluate, and unknown ids or presets', async () => {
      await expect(run({ screenerId: 'bad' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message:
          'Screener "Odd" has filters thndr-mcp cannot evaluate: filter key "ref_price" is not supported.',
      });
      await expect(run({ screenerId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        new ScreenMarket(deps()).execute({ preset: 'moon-shots' as 'value-yield' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
