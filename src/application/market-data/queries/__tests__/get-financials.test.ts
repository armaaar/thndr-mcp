import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  aQuote,
  FakeMarketDataRepository,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { FakeResearchRepository, someFinancials } from '../../../../__tests__/support/fake-research';
import { GetFinancials } from '../get-financials';

const comi = () =>
  someFinancials({
    revenues: [
      ['TTM Q3 25', 90],
      ['TTM Q4 25', 100],
      ['TTM Q1 26', 110],
      ['TTM Q2 26', 120],
    ],
    net_income: [['TTM Q2 26', 60]],
    'roe_%': [['TTM Q2 26', 30]],
    eps: [['TTM Q2 26', 2]],
    nos: [['TTM Q2 26', 100]],
    gross_profit: [],
  });

function setup(research = new FakeResearchRepository()) {
  research.financials.COMI = comi();
  return setupMarketData(withInstruments('COMI'), undefined, research);
}

describe('GetFinancials', () => {
  it('declares its contract', async () => {
    const uc = new GetFinancials(setup());
    expect(uc).toMatchObject({ name: 'get_financials', kind: 'query', context: 'market-data' });
    for (const input of [
      {},
      { symbol: 'COMI', mode: 'weekly' },
      { symbol: 'COMI', periods: 0 },
      { symbol: 'COMI', periods: 41 },
      { symbol: 'COMI', metrics: [''] },
      { symbol: 'COMI', compareToSector: 'yes' },
    ]) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('defaults to TTM, the core metrics and 8 periods', async () => {
    const deps = setup();
    const out = await new GetFinancials(deps).run({ symbol: 'comi' });
    expect(deps.research.calls.getFinancials).toEqual([{ ticker: 'COMI', mode: 'ttm', dataPointCount: 8 }]);
    expect(out).toEqual({
      ticker: 'COMI',
      name: 'COMI Corp',
      currency: 'EGP',
      mode: 'ttm',
      basis: expect.stringContaining('Trailing twelve months'),
      latestPeriod: 'TTM Q2 26',
      units: expect.stringContaining('percent'),
      metrics: {
        revenues: {
          latest: { period: 'TTM Q2 26', value: 120 },
          series: [
            { period: 'TTM Q3 25', value: 90 },
            { period: 'TTM Q4 25', value: 100 },
            { period: 'TTM Q1 26', value: 110 },
            { period: 'TTM Q2 26', value: 120 },
          ],
        },
        net_income: {
          latest: { period: 'TTM Q2 26', value: 60 },
          series: [{ period: 'TTM Q2 26', value: 60 }],
        },
        gross_profit: { latest: null, series: [] },
        eps: { latest: { period: 'TTM Q2 26', value: 2 }, series: [{ period: 'TTM Q2 26', value: 2 }] },
        'roe_%': { latest: { period: 'TTM Q2 26', value: 30 }, series: [{ period: 'TTM Q2 26', value: 30 }] },
      },
      availableMetrics: ['revenues', 'net_income', 'roe_%', 'eps', 'nos', 'gross_profit'],
    });
    expect(out).not.toHaveProperty('sectorComparison');
  });

  it('applies the same defaults when executed directly', async () => {
    const deps = setup();
    const out = await new GetFinancials(deps).execute({ symbol: 'COMI' });
    expect(deps.research.calls.getFinancials).toEqual([{ ticker: 'COMI', mode: 'ttm', dataPointCount: 8 }]);
    expect(out.mode).toBe('ttm');
  });

  it('returns the requested metrics for the last N periods and lists those Thndr lacks', async () => {
    const deps = setup();
    const out = await new GetFinancials(deps).run({
      symbol: 'COMI',
      mode: 'qoq',
      periods: 2,
      metrics: ['revenues', 'total_debt'],
    });
    expect(deps.research.calls.getFinancials[0]).toEqual({ ticker: 'COMI', mode: 'qoq', dataPointCount: 2 });
    expect(out.basis).toContain('Single quarters');
    expect(out.metrics).toEqual({
      revenues: {
        latest: { period: 'TTM Q2 26', value: 120 },
        series: [
          { period: 'TTM Q1 26', value: 110 },
          { period: 'TTM Q2 26', value: 120 },
        ],
      },
    });
    expect(out.unavailable).toEqual(['total_debt']);
  });

  it('returns every metric for "all"', async () => {
    const out = await new GetFinancials(setup()).run({ symbol: 'COMI', metrics: ['ALL'], mode: 'yoy' });
    expect(Object.keys(out.metrics)).toEqual(out.availableMetrics);
    expect(out.unavailable).toBeUndefined();
  });

  it('propagates NOT_FOUND when Thndr has no financials', async () => {
    const deps = setupMarketData(withInstruments('ETF1'));
    await expect(new GetFinancials(deps).run({ symbol: 'ETF1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  describe('compareToSector', () => {
    function sector() {
      const research = new FakeResearchRepository();
      research.financials = {
        COMI: comi(),
        ADIB: someFinancials({ 'roe_%': [['TTM Q2 26', 20]], eps: [['TTM Q2 26', 1]] }),
        HDBK: someFinancials({ 'roe_%': [['TTM Q2 26', 10]], eps: [['TTM Q2 26', 0.5]] }),
      };
      const repository = new FakeMarketDataRepository({
        instruments: [anInstrument({ ticker: 'COMI' })],
        quotes: {
          egypt: [
            aQuote({ ticker: 'COMI', last: 10, listedShares: 100 }),
            aQuote({ ticker: 'ADIB', last: 10, listedShares: 100 }),
            aQuote({ ticker: 'HDBK', last: 10, listedShares: 100 }),
            aQuote({ ticker: 'NOFN', last: 10, listedShares: 100 }),
            aQuote({ ticker: 'DEAD', listedShares: 0 }),
            aQuote({ ticker: 'NOSH', listedShares: null }),
            aQuote({ ticker: 'HRHO', sector: 'Financial Services' }),
          ],
        },
      });
      return setupMarketData(repository, undefined, research);
    }

    it('ranks the company among sector companies with listed shares, as ThndrX does', async () => {
      const deps = sector();
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(deps.research.calls.getFinancialsBatch).toEqual([
        { tickers: ['COMI', 'ADIB', 'HDBK', 'NOFN'], mode: 'ttm' },
      ]);
      const comparison = out.sectorComparison!;
      expect(comparison).toMatchObject({ sector: 'Banks', companies: 4, companiesWithData: 3 });
      expect(comparison.method).toContain('ThndrX');
      expect(comparison.metrics.find((m) => m.key === 'roe')).toEqual({
        key: 'roe',
        category: 'profitability',
        unit: '%',
        lowerIsBetter: false,
        value: 30,
        sectorCount: 3,
        median: 20,
        min: 10,
        max: 30,
        percentile: 100,
      });
      expect(comparison.metrics.find((m) => m.key === 'pe')).toMatchObject({
        value: 5,
        median: 10,
        percentile: 100,
      });
      expect(comparison.ratings).toEqual([{ category: 'valuation', percentile: 100, band: 'green' }]);
      expect(out.notes).toEqual([expect.stringContaining('does not show this comparison for banks')]);
    });

    it('falls back to the single-company statements when the batch lacks the company', async () => {
      const deps = sector();
      const original = deps.research.getFinancialsBatch.bind(deps.research);
      deps.research.getFinancialsBatch = async (tickers, mode) => {
        const batch = await original(tickers, mode);
        batch.delete('COMI');
        return batch;
      };
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison?.metrics.find((m) => m.key === 'roe')).toMatchObject({
        value: 30,
        sectorCount: 2,
      });
    });

    it('adds no bank note for other sectors', async () => {
      const research = new FakeResearchRepository();
      research.financials.HRHO = someFinancials({ 'roe_%': [['TTM Q2 26', 12]] });
      const repository = new FakeMarketDataRepository({
        instruments: [anInstrument({ ticker: 'HRHO', sector: 'Financial Services' })],
        quotes: { egypt: [aQuote({ ticker: 'HRHO', sector: 'Financial Services' })] },
      });
      const out = await new GetFinancials(setupMarketData(repository, undefined, research)).run({
        symbol: 'HRHO',
        compareToSector: true,
      });
      expect(out.sectorComparison).toMatchObject({ sector: 'Financial Services', companies: 1, ratings: [] });
      expect(out.sectorComparison?.metrics.find((m) => m.key === 'roe')).toMatchObject({ percentile: null });
      expect(out.notes).toBeUndefined();
    });

    it('says so when the instrument has no sector in the market snapshot', async () => {
      const deps = setup();
      deps.repository.quotes = { egypt: [aQuote({ ticker: 'COMI', sector: null })] };
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison).toBeNull();
      expect(out.notes).toEqual([expect.stringContaining('no sector')]);
      expect(deps.research.calls.getFinancialsBatch).toHaveLength(0);
    });

    it('says so when the instrument is missing from the market snapshot', async () => {
      const out = await new GetFinancials(setup()).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison).toBeNull();
    });
  });
});
