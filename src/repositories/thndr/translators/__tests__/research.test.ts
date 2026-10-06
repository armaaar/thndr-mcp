import { describe, expect, it } from 'vitest';
import {
  camelCase,
  toEconomicIndicators,
  toFinancialStatements,
  toFinancialsBatch,
  toNewsArticle,
  toNewsPage,
  toYearlyReturn,
} from '../research';

describe('financials translators', () => {
  it('maps every metric series, keeping Thndr’s order and nulls, and skips malformed points', () => {
    const statements = toFinancialStatements(
      {
        currency: 'EGP',
        total_assets: [
          { period: 'TTM Q1 26', value: 1000 },
          { period: 'TTM Q2 26', value: '1,100' },
        ],
        'roe_%': [{ period: 'TTM Q2 26', value: null }, { value: 3 }, null as never],
        note: 'ignored',
      },
      'ttm',
    );
    expect(statements).toEqual({
      currency: 'EGP',
      mode: 'ttm',
      series: {
        total_assets: [
          { period: 'TTM Q1 26', value: 1000 },
          { period: 'TTM Q2 26', value: 1100 },
        ],
        'roe_%': [{ period: 'TTM Q2 26', value: null }],
      },
    });
  });

  it('tolerates an empty or odd payload', () => {
    expect(toFinancialStatements(null, 'qoq')).toEqual({ currency: null, mode: 'qoq', series: {} });
    expect(toFinancialStatements({ currency: '' }, 'yoy').currency).toBeNull();
  });

  it('maps a batch keyed by symbol and drops companies without series', () => {
    const batch = toFinancialsBatch(
      {
        COMI: { currency: 'EGP', revenues: [{ period: 'Q2 26', value: 5 }] },
        adib: { currency: 'EGP', revenues: [{ period: 'Q2 26', value: 2 }] },
        EMPTY: {},
        NULL: null,
      },
      'qoq',
    );
    expect([...batch.keys()]).toEqual(['COMI', 'ADIB']);
    expect(batch.get('ADIB')?.series.revenues).toEqual([{ period: 'Q2 26', value: 2 }]);
    expect(toFinancialsBatch(null, 'qoq').size).toBe(0);
  });
});

describe('news translators', () => {
  it('maps an article with its tagged tickers', () => {
    expect(
      toNewsArticle({
        id: 686536,
        stocks: [{ symbol: 'COMI', asset_id: 'x' }, { asset_id: 'no-symbol' }, null as never],
        title: 'Release from CIB',
        content: '  Results for the period.  ',
        created_at: '2026-07-21T11:16:53+03:00',
        locale: 'en',
        market: 'egypt',
        link: 'https://egx.com.eg/1.pdf',
        source: 'egx',
        source_logo: '',
      }),
    ).toEqual({
      id: '686536',
      title: 'Release from CIB',
      content: 'Results for the period.',
      source: 'egx',
      link: 'https://egx.com.eg/1.pdf',
      publishedAt: new Date('2026-07-21T08:16:53Z'),
      market: 'egypt',
      tickers: ['COMI'],
    });
  });

  it('defaults missing fields and rejects items without an id', () => {
    expect(toNewsArticle({ id: 'a1' })).toEqual({
      id: 'a1',
      title: '',
      content: '',
      source: null,
      link: null,
      publishedAt: null,
      market: null,
      tickers: [],
    });
    expect(toNewsArticle({ title: 'no id' })).toBeNull();
    expect(toNewsArticle(null)).toBeNull();
  });

  it('maps a page with its count and whether a next page exists', () => {
    const page = toNewsPage({
      count: 202,
      next: 'https://prod.thndr.app/api/post/news/?page=2',
      results: [{ id: 1 }, {}],
    });
    expect(page.total).toBe(202);
    expect(page.hasMore).toBe(true);
    expect(page.articles.map((a) => a.id)).toEqual(['1']);
    expect(toNewsPage({ count: 1, next: null, results: [] }).hasMore).toBe(false);
    expect(toNewsPage(null)).toEqual({ total: null, hasMore: false, articles: [] });
  });
});

describe('macros translator', () => {
  it('camel-cases Thndr keys', () => {
    expect(camelCase('headline_inflation_yearly')).toBe('headlineInflationYearly');
    expect(camelCase('treasury_bills_12m')).toBe('treasuryBills12m');
  });

  it('maps metadata, overview readings, GDP and every series sorted oldest first', () => {
    const indicators = toEconomicIndicators({
      metadata: {
        description: 'Egypt Macroeconomic Data',
        extracted_at: '2026-09-07T17:30:38.750981',
        sources: { inflation_yearly: 'Monthly inflation (year-to-year)', bad: 3 },
      },
      overview: {
        headline_inflation_yearly: { value: 14.9, date: '2026-07-01', growth: 0.6 },
        unemployment: { value: 5.8, period: 'Q2 2026', growth: -0.2 },
        gdp: { gdp_egp: 18_136_000_000_000, gdp_growth_usd: 6.92, label: 'x' },
        odd: { text: 'no numbers' },
        broken: null,
      },
      inflation_yearly: [
        {
          date: '2025-02-01',
          headline: 12.84,
          core: 10.01,
          goods_and_services: 25.56,
          fruits_and_vegetables: 7.36,
        },
        { date: '2025-01-01', headline: '23.95' },
        { headline: 1 },
      ],
      inflation_monthly: [{ date: '2025-01-01', headline: 1.51 }],
      overnight_rates: [{ date: '2025-04-22', deposits_rate: 25, lending_rate: 26 }],
      treasury_bills: [
        {
          date: '2025-01-02',
          '1m_return': 27.472,
          '3m_return': 27.7,
          '6m_return': 28.3,
          '9m_return': 26,
          '12m_return': 25.4,
        },
      ],
      unemployment: [
        { year: 2020, quarter: 2, rate: 9.6 },
        { year: 2020, quarter: 1, rate: 7.7 },
        { year: null, quarter: 1, rate: 1 },
        null as never,
      ],
    });
    expect(indicators).toEqual({
      description: 'Egypt Macroeconomic Data',
      extractedAt: '2026-09-07T17:30:38.750981',
      sources: { inflationYearly: 'Monthly inflation (year-to-year)' },
      overview: {
        headlineInflationYearly: { value: 14.9, date: '2026-07-01', period: null, change: 0.6 },
        unemployment: { value: 5.8, date: null, period: 'Q2 2026', change: -0.2 },
      },
      gdp: { gdpEgp: 18_136_000_000_000, gdpGrowthUsd: 6.92 },
      inflationYearly: [
        {
          date: '2025-01-01',
          headline: 23.95,
          core: null,
          goodsAndServices: null,
          fruitsAndVegetables: null,
        },
        {
          date: '2025-02-01',
          headline: 12.84,
          core: 10.01,
          goodsAndServices: 25.56,
          fruitsAndVegetables: 7.36,
        },
      ],
      inflationMonthly: [
        { date: '2025-01-01', headline: 1.51, core: null, goodsAndServices: null, fruitsAndVegetables: null },
      ],
      overnightRates: [{ date: '2025-04-22', depositRate: 25, lendingRate: 26 }],
      treasuryBills: [
        {
          date: '2025-01-02',
          oneMonth: 27.472,
          threeMonths: 27.7,
          sixMonths: 28.3,
          nineMonths: 26,
          twelveMonths: 25.4,
        },
      ],
      unemployment: [
        { period: 'Q1 2020', year: 2020, quarter: 1, rate: 7.7 },
        { period: 'Q2 2020', year: 2020, quarter: 2, rate: 9.6 },
      ],
    });
  });

  it('tolerates an empty payload', () => {
    expect(toEconomicIndicators(null)).toEqual({
      description: null,
      extractedAt: null,
      sources: {},
      overview: {},
      gdp: null,
      inflationYearly: [],
      inflationMonthly: [],
      overnightRates: [],
      treasuryBills: [],
      unemployment: [],
    });
  });
});

describe('yearly return translator', () => {
  it('maps Thndr’s annual return and its direction', () => {
    expect(toYearlyReturn({ annual_return: { value: 30.01, return: 'gain' } })).toEqual({
      percent: 30.01,
      direction: 'gain',
    });
    expect(toYearlyReturn({ annual_return: { value: '-4.5' } })).toEqual({ percent: -4.5, direction: null });
  });

  it('is null when absent or not a number', () => {
    expect(toYearlyReturn({})).toBeNull();
    expect(toYearlyReturn({ annual_return: { value: null, return: 'loss' } })).toBeNull();
    expect(toYearlyReturn(null)).toBeNull();
  });
});
