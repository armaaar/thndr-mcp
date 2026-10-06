import { describe, expect, it } from 'vitest';
import {
  aCandle,
  anInstrument,
  aQuote,
  FakeMarketDataRepository,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { FakeResearchRepository, someFinancials } from '../../../../__tests__/support/fake-research';
import { FeatureDisabledError, NotAuthenticatedError, UpstreamError } from '../../../errors';
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
    const NOW = new Date('2026-10-06T10:00:00Z');
    const bar = (time: string, close: number) =>
      aCandle({ time: new Date(time), close, high: close, low: close });

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
      // TTM Q2 26 ends 2026-06-30 23:59:59.999 UTC: the 30 June bar is the last one on or before it.
      repository.candles = [
        bar('2026-07-01T00:00:00Z', 40),
        bar('2026-06-29T00:00:00Z', 12),
        bar('2026-06-30T00:00:00Z', 15),
        bar('2025-12-31T00:00:00Z', 9),
      ];
      return setupMarketData(repository, NOW, research);
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
        source: 'roe_%',
        value: 30,
        sectorCount: 3,
        median: 20,
        min: 10,
        max: 30,
        percentile: 100,
      });
      expect(out.notes).toEqual([expect.stringContaining('does not show this comparison for banks')]);
    });

    it('prices the company’s own multiples at the close on or before the end of its latest period, peers at today’s price', async () => {
      const deps = sector();
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      const call = deps.repository.calls.getCandles[0]!;
      expect(call).toMatchObject({
        resolution: '1d',
        to: NOW,
        from: new Date(NOW.getTime() - 3 * 365 * 86_400_000),
      });
      const comparison = out.sectorComparison!;
      expect(comparison.valuationPrice).toEqual({
        period: 'TTM Q2 26',
        periodEnd: '2026-06-30',
        basis: 'periodEndClose',
        price: 15,
        priceDate: '2026-06-30',
      });
      // Company P/E = 15 / 2 = 7.5; the sector sample holds every company at today's price 10: COMI 5, ADIB 10, HDBK 20.
      expect(comparison.metrics.find((m) => m.key === 'pe')).toMatchObject({
        source: 'price / eps (left out when negative)',
        value: 7.5,
        sectorCount: 3,
        median: 10,
        min: 5,
        max: 20,
        percentile: 75,
        companyPrice: 'periodEndClose',
      });
      expect(comparison.metrics.find((m) => m.key === 'roe')).not.toHaveProperty('companyPrice');
      expect(comparison.ratings).toEqual([{ category: 'valuation', percentile: 75, band: 'lightGreen' }]);
    });

    it('loads 8 years of candles for fiscal years and prices at 31 December', async () => {
      const deps = sector();
      deps.research.financials.COMI = someFinancials({ eps: [['2025', 2]] }, 'yoy');
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', mode: 'yoy', compareToSector: true });
      expect(deps.repository.calls.getCandles[0]?.from).toEqual(
        new Date(NOW.getTime() - 8 * 365 * 86_400_000),
      );
      expect(out.sectorComparison?.valuationPrice).toMatchObject({
        period: '2025',
        periodEnd: '2025-12-31',
        price: 9,
        priceDate: '2025-12-31',
      });
    });

    it('uses today’s price and says so when the candles do not reach back to the period end', async () => {
      const deps = sector();
      deps.repository.candles = [bar('2026-07-01T00:00:00Z', 40)];
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison?.valuationPrice).toMatchObject({
        basis: 'currentPrice',
        price: 10,
        priceDate: null,
        reason: 'beforeHistory',
      });
      expect(out.sectorComparison?.metrics.find((m) => m.key === 'pe')).toMatchObject({
        value: 5,
        companyPrice: 'currentPrice',
      });
      expect(out.notes).toEqual([
        expect.stringContaining('banks'),
        expect.stringContaining('ThndrX leaves them empty'),
      ]);
    });

    it('uses today’s price, as ThndrX does, when Thndr returns no candles', async () => {
      const deps = sector();
      deps.repository.candles = [];
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison?.valuationPrice).toMatchObject({
        basis: 'currentPrice',
        reason: 'noCandles',
      });
      expect(out.notes?.[1]).toContain('no daily candles');
    });

    it('uses today’s price when the candle request fails, and propagates other errors', async () => {
      const deps = sector();
      deps.repository.failures.getCandles = new UpstreamError('Thndr API error 500', 500);
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison?.valuationPrice).toMatchObject({ basis: 'currentPrice', price: 10 });
      expect(out.notes?.[1]).toContain('could not be loaded');

      deps.repository.failures.getCandles = new FeatureDisabledError('Feature disabled for user');
      const disabled = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(disabled.sectorComparison?.valuationPrice).toMatchObject({ basis: 'currentPrice' });

      deps.repository.failures.getCandles = new NotAuthenticatedError();
      await expect(
        new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    });

    it('returns no comparison, with a note, when the sector batch fails upstream', async () => {
      const deps = sector();
      deps.research.failures.getFinancialsBatch = new UpstreamError(
        'Thndr API error 429 on GET /financials',
        429,
      );
      const out = await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true });
      expect(out.sectorComparison).toBeNull();
      expect(out.notes).toEqual([expect.stringContaining('429')]);
      expect(out.metrics.revenues?.latest).toEqual({ period: 'TTM Q2 26', value: 120 });

      deps.research.failures.getFinancialsBatch = new FeatureDisabledError('Feature disabled for user');
      expect(
        (await new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true })).sectorComparison,
      ).toBeNull();

      deps.research.failures.getFinancialsBatch = new NotAuthenticatedError();
      await expect(
        new GetFinancials(deps).run({ symbol: 'COMI', compareToSector: true }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
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
      repository.candles = [aCandle({ time: new Date('2026-01-01T00:00:00Z') })];
      const out = await new GetFinancials(setupMarketData(repository, NOW, research)).run({
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
