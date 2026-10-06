import { describe, expect, it } from 'vitest';
import { someFinancials } from '../../../__tests__/support/fake-research';
import {
  COMPARISON_METRICS,
  compareWithSector,
  comparisonValues,
  percentileRank,
  ratingBand,
  type SectorMember,
  sectorStats,
} from '../sector-comparison';

const market = (
  price: number | null,
  listedShares: number | null = 100,
  dividendYieldPercent: number | null = null,
) => ({
  price,
  listedShares,
  dividendYieldPercent,
});

describe('ThndrX metric table', () => {
  // Bundle chunk 334 builders (order, includeInRating: false, the qoq-hidden 3-year averages) and the chunk 6076
  // lower-is-better map `en`: [key, category, lowerIsBetter, rated, hiddenInQoq].
  const THNDRX: Array<[string, string, boolean, boolean, boolean]> = [
    ['netDebtTotalEquity', 'financialHealth', true, true, false],
    ['netDebtEbitda', 'financialHealth', true, true, false],
    ['interestCoverageRatio', 'financialHealth', false, true, false],
    ['quickRatio', 'financialHealth', false, true, false],
    ['freeCashFlowYield', 'efficiency', false, true, false],
    ['cfoToRevenue', 'efficiency', false, true, false],
    ['assetsTurnover', 'efficiency', false, true, false],
    ['receivablesTurnover', 'efficiency', false, true, false],
    ['inventoryTurnover', 'efficiency', false, true, false],
    ['revenueGrowth', 'growth', false, true, false],
    ['avgRevenueGrowth3y', 'growth', false, false, true],
    ['epsGrowth', 'growth', false, true, false],
    ['avgEpsGrowth3y', 'growth', false, false, true],
    ['assetsGrowth', 'growth', false, true, false],
    ['equityGrowth', 'growth', false, true, false],
    ['roe', 'profitability', false, false, false],
    ['roa', 'profitability', false, false, false],
    ['roic', 'profitability', false, true, false],
    ['grossMargin', 'profitability', false, false, false],
    ['operatingMargin', 'profitability', false, true, false],
    ['netMargin', 'profitability', false, true, false],
    ['roae', 'profitability', false, true, false],
    ['pe', 'valuation', true, true, false],
    ['pb', 'valuation', true, true, false],
    ['evEbitda', 'valuation', true, true, false],
    ['ps', 'valuation', true, false, false],
    ['peg', 'valuation', true, false, false],
    ['dividendYield', 'valuation', false, false, false],
  ];

  it('matches the bundle for every metric, in display order', () => {
    expect(
      COMPARISON_METRICS.map((d) => [d.key, d.category, d.lowerIsBetter, d.rated, d.hiddenInQoq ?? false]),
    ).toEqual(THNDRX);
  });

  it.each(THNDRX)(
    '%s: %s, lowerIsBetter %s, rated %s, hiddenInQoq %s',
    (key, category, lower, rated, hidden) => {
      const metric = COMPARISON_METRICS.find((d) => d.key === key);
      expect(metric).toMatchObject({ category, lowerIsBetter: lower, rated });
      expect(metric?.hiddenInQoq ?? false).toBe(hidden);
      expect(metric?.source).toEqual(expect.any(String));
    },
  );

  it('marks the price-based metrics and names each value’s Thndr key or formula', () => {
    expect(COMPARISON_METRICS.filter((d) => d.priceBased).map((d) => d.key)).toEqual([
      'freeCashFlowYield',
      'pe',
      'pb',
      'evEbitda',
      'ps',
      'peg',
    ]);
    const source = (key: string) => COMPARISON_METRICS.find((d) => d.key === key)?.source;
    expect(source('roe')).toBe('roe_%');
    expect(source('netDebtEbitda')).toBe('net_debt_ebitda');
    expect(source('freeCashFlowYield')).toContain('st_investments');
    expect(source('pe')).toBe('price / eps (left out when negative)');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(COMPARISON_METRICS)).toBe(true);
    expect(Object.isFrozen(COMPARISON_METRICS[0])).toBe(true);
  });
});

describe('sector statistics (ThndrX s2)', () => {
  it('computes median, min and max', () => {
    expect(sectorStats([])).toEqual({ median: null, min: null, max: null });
    expect(sectorStats([3, 1, 2])).toEqual({ median: 2, min: 1, max: 3 });
    expect(sectorStats([4, 1, 3, 2])).toEqual({ median: 2.5, min: 1, max: 4 });
  });
});

describe('percentile rank (ThndrX formula)', () => {
  it('scales the average rank to 1–100, 100 being best', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentileRank(5, sorted, false)).toBe(100);
    expect(percentileRank(1, sorted, false)).toBe(1);
    expect(percentileRank(3, sorted, false)).toBe(50.5);
    expect(percentileRank(1, sorted, true)).toBe(100);
    expect(percentileRank(5, sorted, true)).toBe(1);
  });

  it('gives ties their mean rank and ranks values absent from the sample between neighbours', () => {
    expect(percentileRank(2, [1, 2, 2, 3], false)).toBe(50.5);
    expect(percentileRank(2.5, [1, 2, 3], false)).toBeCloseTo(75.25);
  });

  it('needs a value and at least two sector values', () => {
    expect(percentileRank(null, [1, 2], false)).toBeNull();
    expect(percentileRank(1, [1], false)).toBeNull();
  });
});

describe('rating bands', () => {
  it('follows ThndrX colours', () => {
    expect([81, 80, 60, 59.9, 40, 20, 19].map(ratingBand)).toEqual([
      'green',
      'lightGreen',
      'lightGreen',
      'yellow',
      'yellow',
      'orange',
      'red',
    ]);
  });
});

describe('comparison values', () => {
  it('reads the last value of each series, valuation at today’s price and cash-flow ratios in percent', () => {
    const s = someFinancials({
      net_debt_total_equity: [['TTM Q2 26', 0.5]],
      'roe_%': [
        ['TTM Q1 26', 20],
        ['TTM Q2 26', 25],
      ],
      eps: [['TTM Q2 26', 2]],
      fcff: [['TTM Q2 26', 50]],
      total_debt: [['TTM Q2 26', 100]],
      cfo: [['TTM Q2 26', 30]],
      revenues: [['TTM Q2 26', 300]],
    });
    const values = comparisonValues(s, market(10, 100, 4));
    expect(values).toMatchObject({
      netDebtTotalEquity: 0.5,
      roe: 25,
      pe: 5,
      freeCashFlowYield: (50 / 1100) * 100,
      cfoToRevenue: 10,
      dividendYield: 4,
      roic: null,
    });
    expect(Object.keys(values).sort()).toEqual(COMPARISON_METRICS.map((m) => m.key).sort());
  });

  it('nets cash and short-term investments out of the free-cash-flow yield denominator', () => {
    const s = someFinancials({
      fcff: [['TTM Q2 26', 60]],
      total_debt: [['TTM Q2 26', 300]],
      total_cash_and_cash_equivalents: [['TTM Q2 26', 100]],
      st_investments: [['TTM Q2 26', 200]],
    });
    // Market cap 10 × 100 = 1000; firm value = 1000 + 300 − 100 − 200 = 1000.
    expect(comparisonValues(s, market(10)).freeCashFlowYield).toBe(6);
  });

  it('leaves cash-flow ratios out when their inputs are missing', () => {
    expect(comparisonValues(someFinancials({}), market(null, null))).toMatchObject({
      freeCashFlowYield: null,
      cfoToRevenue: null,
    });
  });
});

describe('compareWithSector', () => {
  const member = (roe: number | null, pe: number, extra: Record<string, number> = {}): SectorMember => ({
    statements: someFinancials({
      'roe_%': [['TTM Q2 26', roe]],
      'roic_%': [['TTM Q2 26', roe === null ? null : roe / 2]],
      eps: [['TTM Q2 26', 10 / pe]],
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, [['TTM Q2 26', v]]])),
    }),
    market: market(10),
  });

  it('ranks the company against the non-zero sector values and rates each category', () => {
    const company = member(30, 5, { avg_revenue_growth_3y: 12 });
    const sector = [company, member(10, 10), member(20, 20), member(0, 8), member(null, 4)];
    const { metrics, ratings } = compareWithSector(company, sector, 'ttm');
    const roe = metrics.find((m) => m.key === 'roe');
    expect(roe).toMatchObject({
      value: 30,
      sectorCount: 3,
      median: 20,
      min: 10,
      max: 30,
      percentile: 100,
      unit: '%',
    });
    const pe = metrics.find((m) => m.key === 'pe');
    expect(pe).toMatchObject({ value: 5, sectorCount: 5, median: 8, lowerIsBetter: true });
    expect(pe?.percentile).toBeCloseTo(75.25);
    expect(metrics.find((m) => m.key === 'avgRevenueGrowth3y')).toMatchObject({
      value: 12,
      sectorCount: 1,
      percentile: null,
    });
    // Profitability rating: roic (100) is rated, roe is not; valuation: pe only (ps, peg, dividendYield unrated/empty).
    expect(ratings).toEqual([
      { category: 'profitability', percentile: 100, band: 'green' },
      { category: 'valuation', percentile: 75, band: 'lightGreen' },
    ]);
  });

  it('ranks P/B and net debt/EBITDA lower-is-better, and leaves P/S and gross margin out of the ratings', () => {
    const company: SectorMember = {
      statements: someFinancials({
        total_equity: [['TTM Q2 26', 1000]],
        net_debt_ebitda: [['TTM Q2 26', 1]],
        revenues: [['TTM Q2 26', 1000]],
        'gross_margin_%': [['TTM Q2 26', 50]],
      }),
      market: market(10),
    };
    const peer = (
      equity: number,
      netDebtEbitda: number,
      revenues: number,
      grossMargin: number,
    ): SectorMember => ({
      statements: someFinancials({
        total_equity: [['TTM Q2 26', equity]],
        net_debt_ebitda: [['TTM Q2 26', netDebtEbitda]],
        revenues: [['TTM Q2 26', revenues]],
        'gross_margin_%': [['TTM Q2 26', grossMargin]],
      }),
      market: market(10),
    });
    const sector = [company, peer(500, 3, 500, 10)];
    const { metrics, ratings } = compareWithSector(company, sector, 'ttm');
    const percentile = (key: string) => metrics.find((x) => x.key === key)?.percentile;
    expect(percentile('pb')).toBe(100); // P/B 1 vs 2
    expect(percentile('netDebtEbitda')).toBe(100); // 1 vs 3
    expect(percentile('ps')).toBe(100); // P/S 1 vs 2, but unrated
    expect(percentile('grossMargin')).toBe(100); // unrated
    expect(ratings).toEqual([
      { category: 'financialHealth', percentile: 100, band: 'green' },
      { category: 'valuation', percentile: 100, band: 'green' },
    ]);
  });

  it('bands a category on its unrounded mean percentile', () => {
    // Quick ratio 5 among [1..6]: rank 5 → 1 + 4 × 99 / 5 = 80.2, shown as 80 but banded green (> 80).
    const member = (quickRatio: number): SectorMember => ({
      statements: someFinancials({ quick_ratio: [['TTM Q2 26', quickRatio]] }),
      market: market(10),
    });
    const sector = [1, 2, 3, 4, 5, 6].map(member);
    const { metrics, ratings } = compareWithSector(member(5), sector, 'ttm');
    expect(metrics.find((x) => x.key === 'quickRatio')?.percentile).toBeCloseTo(80.2);
    expect(ratings).toEqual([{ category: 'financialHealth', percentile: 80, band: 'green' }]);
  });

  it('hides the 3-year averages for quarterly data', () => {
    const company = member(30, 5);
    const keys = compareWithSector(company, [company], 'qoq').metrics.map((m) => m.key);
    expect(keys).not.toContain('avgRevenueGrowth3y');
    expect(keys).not.toContain('avgEpsGrowth3y');
    expect(keys).toContain('revenueGrowth');
  });
});
