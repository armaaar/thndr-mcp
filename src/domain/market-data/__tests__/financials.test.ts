import { describe, expect, it } from 'vitest';
import { aCandle } from '../../../__tests__/support/fake-market-data';
import { someFinancials } from '../../../__tests__/support/fake-research';
import { ValidationError } from '../../shared-kernel/errors';
import {
  comparePeriods,
  createFinancialStatements,
  DEFAULT_FINANCIAL_METRICS,
  FINANCIAL_METRIC_GROUPS,
  latestPeriod,
  latestValue,
  periodEnd,
  ratio,
  VALUATION_PRICE_YEARS,
  valuation,
  valuationPrice,
  valueAt,
} from '../financials';

describe('financial statements', () => {
  it('are frozen copies and reject unknown modes', () => {
    const points = [{ period: 'Q1 26', value: 1 }];
    const statements = createFinancialStatements({
      currency: 'EGP',
      mode: 'qoq',
      series: { revenues: points },
    });
    points[0]!.value = 99;
    expect(statements.series.revenues).toEqual([{ period: 'Q1 26', value: 1 }]);
    expect(Object.isFrozen(statements)).toBe(true);
    expect(Object.isFrozen(statements.series)).toBe(true);
    expect(Object.isFrozen(statements.series.revenues?.[0])).toBe(true);
    expect(() => createFinancialStatements({ currency: null, mode: 'weekly' as never, series: {} })).toThrow(
      ValidationError,
    );
  });

  it('the default metrics come from the catalogue', () => {
    const catalogue = new Set<string>(Object.values(FINANCIAL_METRIC_GROUPS).flat());
    expect(DEFAULT_FINANCIAL_METRICS.filter((key) => !catalogue.has(key))).toEqual([]);
  });

  it('orders periods chronologically: years, quarters (2- or 4-digit years), TTM after the plain quarter', () => {
    const labels = ['TTM Q2 26', '2025', 'Q2 26', 'Q1 2026', 'Q4 25', 'Q3 25'];
    expect([...labels].sort(comparePeriods)).toEqual([
      'Q3 25',
      'Q4 25',
      '2025',
      'Q1 2026',
      'Q2 26',
      'TTM Q2 26',
    ]);
    expect(comparePeriods('H1 26', 'H2 26')).toBeLessThan(0);
    expect(comparePeriods('Q1 26', 'later')).toBe('Q1 26'.localeCompare('later'));
  });

  it('finds the latest period over every metric and reads values', () => {
    const s = someFinancials({
      revenues: [
        ['Q4 25', 10],
        ['Q1 26', 12],
      ],
      eps: [
        ['Q1 26', 1],
        ['Q2 26', null],
      ],
    });
    expect(latestPeriod(s)).toBe('Q2 26');
    expect(latestPeriod(someFinancials({}))).toBeNull();
    expect(latestValue(s, 'revenues')).toBe(12);
    expect(latestValue(s, 'eps')).toBeNull();
    expect(latestValue(s, 'missing')).toBeNull();
    expect(valueAt(s, 'revenues', 'Q4 25')).toBe(10);
    expect(valueAt(s, 'revenues', 'Q2 26')).toBeNull();
  });

  it('divides safely', () => {
    expect(ratio(6, 3)).toBe(2);
    expect(ratio(6, 0)).toBeNull();
    expect(ratio(null, 3)).toBeNull();
    expect(ratio(6, undefined)).toBeNull();
  });
});

describe('valuation (ThndrX module 36255)', () => {
  const market = { price: 10, listedShares: 100, dividendYieldPercent: 3 };

  it('computes market cap, EV and the multiples against the latest period', () => {
    const s = someFinancials({
      total_debt: [['TTM Q2 26', 300]],
      total_cash_and_cash_equivalents: [['TTM Q2 26', 100]],
      st_investments: [['TTM Q2 26', 50]],
      total_equity: [['TTM Q2 26', 600]],
      minority_interest_bs: [['TTM Q2 26', 100]],
      eps: [
        ['TTM Q1 26', 9],
        ['TTM Q2 26', 2],
      ],
      'eps_growth_%': [['TTM Q2 26', 25]],
      revenues: [['TTM Q2 26', 500]],
      ebitda: [['TTM Q2 26', 230]],
      ebit: [['TTM Q2 26', 115]],
    });
    expect(valuation(s, market)).toEqual({
      price: 10,
      marketCap: 1000,
      enterpriseValue: 1150,
      peRatio: 5,
      pbRatio: 2,
      psRatio: 2,
      pegRatio: 0.2,
      evEbitda: 5,
      evEbit: 10,
      evRevenues: 2.3,
    });
  });

  it('drops a negative P/E, falls back to price / BVPS and tolerates missing figures', () => {
    const s = someFinancials({ eps: [['2025', -1]], bvps: [['2025', 4]], total_equity: [['2025', 50]] });
    const v = valuation(s, { price: 10, listedShares: null, dividendYieldPercent: null });
    expect(v).toMatchObject({
      marketCap: null,
      enterpriseValue: null,
      peRatio: null,
      pbRatio: 2.5,
      pegRatio: null,
    });
  });

  it('has nothing to value without any period', () => {
    expect(valuation(someFinancials({}), market)).toMatchObject({
      price: 10,
      marketCap: null,
      peRatio: null,
    });
  });
});

describe('period ends (ThndrX module 13280 cD)', () => {
  it('ends quarters on their last calendar day and years on 31 December, at the last UTC millisecond', () => {
    expect(periodEnd('Q1 26')?.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    expect(periodEnd('TTM Q2 26')?.toISOString()).toBe('2026-06-30T23:59:59.999Z');
    expect(periodEnd('Q3 2025')?.toISOString()).toBe('2025-09-30T23:59:59.999Z');
    expect(periodEnd(' ttm q4 25 ')?.toISOString()).toBe('2025-12-31T23:59:59.999Z');
    expect(periodEnd('2024')?.toISOString()).toBe('2024-12-31T23:59:59.999Z');
    expect(periodEnd('H1 26')).toBeNull();
  });
});

describe('valuation price (ThndrX module 36255 valuateForPeriod)', () => {
  const bar = (time: string, close: number) =>
    aCandle({ time: new Date(time), close, high: close, low: close });
  const ttm = someFinancials({ eps: [['TTM Q2 26', 2]], revenues: [['TTM Q1 26', 1]] });

  it('loads 3 years of daily candles for quarters and 8 for fiscal years', () => {
    expect(VALUATION_PRICE_YEARS).toEqual({ ttm: 3, qoq: 3, yoy: 8 });
  });

  it('takes the close of the last candle at or before the end of the latest period, whatever the order', () => {
    const price = valuationPrice(
      ttm,
      [
        bar('2026-07-01T00:00:00Z', 30),
        bar('2026-06-30T23:59:59.999Z', 25),
        bar('2026-06-29T00:00:00Z', 20),
        bar('2026-06-30T23:59:59.999Z', 26),
      ],
      99,
    );
    expect(price).toEqual({
      period: 'TTM Q2 26',
      periodEnd: '2026-06-30',
      basis: 'periodEndClose',
      price: 26,
      priceDate: '2026-06-30',
    });
    expect(Object.isFrozen(price)).toBe(true);
  });

  it('uses the latest close when the period has not ended yet', () => {
    expect(valuationPrice(ttm, [bar('2026-05-03T00:00:00Z', 12)], 99)).toMatchObject({
      basis: 'periodEndClose',
      price: 12,
      priceDate: '2026-05-03',
    });
  });

  it('falls back to the current price without a period, without candles, or before the candle history', () => {
    expect(valuationPrice(someFinancials({}), [bar('2026-01-01T00:00:00Z', 1)], 9)).toEqual({
      period: null,
      periodEnd: null,
      basis: 'currentPrice',
      price: 9,
      priceDate: null,
      reason: 'noPeriod',
    });
    expect(valuationPrice(someFinancials({ eps: [['FY26', 1]] }), [], 9)).toMatchObject({
      period: 'FY26',
      periodEnd: null,
      reason: 'noPeriod',
    });
    expect(valuationPrice(ttm, [], null)).toMatchObject({
      periodEnd: '2026-06-30',
      basis: 'currentPrice',
      price: null,
      reason: 'noCandles',
    });
    expect(valuationPrice(ttm, [bar('2026-07-01T00:00:00Z', 30)], 9)).toMatchObject({
      price: 9,
      reason: 'beforeHistory',
    });
  });
});
