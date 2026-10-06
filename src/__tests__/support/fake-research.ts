import { NotFoundError } from '../../application/errors';
import {
  createFinancialStatements,
  type FinancialMode,
  type FinancialPoint,
  type FinancialStatements,
} from '../../domain/market-data/financials';
import type {
  EconomicIndicators,
  NewsArticle,
  NewsPage,
  YearlyReturn,
} from '../../domain/market-data/research';
import type { NewsQuery, ResearchRepository } from '../../domain/market-data/research-repository';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Ticker } from '../../domain/shared-kernel/ticker';

/** Builds statements from `{metric: [[period, value], …]}`. */
export function someFinancials(
  series: Record<string, Array<[string, number | null]>>,
  mode: FinancialMode = 'ttm',
  currency: string | null = 'EGP',
): FinancialStatements {
  const mapped: Record<string, FinancialPoint[]> = {};
  for (const [key, points] of Object.entries(series)) {
    mapped[key] = points.map(([period, value]) => ({ period, value }));
  }
  return createFinancialStatements({ currency, mode, series: mapped });
}

export function aNewsArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: '1',
    title: 'Release from COMI',
    content: 'Financial results for the period ending 30/06/2026.',
    source: 'egx',
    link: 'https://egx.com.eg/downloads/Bulletins/1.pdf',
    publishedAt: new Date('2026-07-21T08:16:53Z'),
    market: 'egypt',
    tickers: ['COMI'],
    ...overrides,
  };
}

export function someEconomicIndicators(overrides: Partial<EconomicIndicators> = {}): EconomicIndicators {
  return {
    description: 'Egypt Macroeconomic Data',
    extractedAt: '2026-09-07T17:30:38.750981',
    sources: { inflationYearly: 'Monthly inflation (year-to-year)' },
    overview: { depositRate: { value: 19, date: '2026-08-20', period: null, change: 0 } },
    gdp: { gdpEgp: 18_136_000_000_000 },
    inflationYearly: [
      { date: '2026-06-01', headline: 14.3, core: 14.3, goodsAndServices: null, fruitsAndVegetables: null },
      { date: '2026-07-01', headline: 14.9, core: 14.7, goodsAndServices: null, fruitsAndVegetables: null },
    ],
    inflationMonthly: [
      { date: '2026-07-01', headline: 1.1, core: 0.9, goodsAndServices: null, fruitsAndVegetables: null },
    ],
    overnightRates: [
      { date: '2026-05-22', depositRate: 20, lendingRate: 21 },
      { date: '2026-08-20', depositRate: 19, lendingRate: 20 },
    ],
    treasuryBills: [
      {
        date: '2026-09-06',
        oneMonth: 24,
        threeMonths: 24.5,
        sixMonths: 24.2,
        nineMonths: 24.1,
        twelveMonths: 23.9,
      },
    ],
    unemployment: [{ period: 'Q2 2026', year: 2026, quarter: 2, rate: 5.8 }],
    ...overrides,
  };
}

/** In-memory ResearchRepository: seed financials by ticker, news, macros, yearly returns; inspect the calls. */
export class FakeResearchRepository implements ResearchRepository {
  /** Ticker → statements (served for every mode). */
  financials: Record<string, FinancialStatements> = {};
  news: NewsPage = { total: 0, hasMore: false, articles: [] };
  indicators: EconomicIndicators = someEconomicIndicators();
  /** Asset id → yearly return. */
  yearlyReturns: Record<string, YearlyReturn> = {};
  failures: Partial<Record<keyof ResearchRepository, Error>> = {};

  readonly calls = {
    getFinancials: [] as Array<{ ticker: string; mode: FinancialMode; dataPointCount?: number }>,
    getFinancialsBatch: [] as Array<{ tickers: string[]; mode: FinancialMode }>,
    getNews: [] as NewsQuery[],
    getEconomicIndicators: 0,
    getYearlyReturn: [] as AssetId[],
  };

  async getFinancials(
    ticker: Ticker,
    mode: FinancialMode,
    dataPointCount?: number,
  ): Promise<FinancialStatements> {
    this.calls.getFinancials.push({ ticker: ticker.value, mode, dataPointCount });
    this.fail('getFinancials');
    const found = this.financials[ticker.value];
    if (!found) throw new NotFoundError(`Thndr has no financials for ${ticker.value}.`);
    return found;
  }

  async getFinancialsBatch(
    tickers: readonly Ticker[],
    mode: FinancialMode,
  ): Promise<Map<string, FinancialStatements>> {
    this.calls.getFinancialsBatch.push({ tickers: tickers.map((t) => t.value), mode });
    this.fail('getFinancialsBatch');
    const batch = new Map<string, FinancialStatements>();
    for (const ticker of tickers) {
      const found = this.financials[ticker.value];
      if (found) batch.set(ticker.value, found);
    }
    return batch;
  }

  async getNews(query: NewsQuery): Promise<NewsPage> {
    this.calls.getNews.push(query);
    this.fail('getNews');
    return this.news;
  }

  async getEconomicIndicators(): Promise<EconomicIndicators> {
    this.calls.getEconomicIndicators++;
    this.fail('getEconomicIndicators');
    return this.indicators;
  }

  async getYearlyReturn(id: AssetId): Promise<YearlyReturn | null> {
    this.calls.getYearlyReturn.push(id);
    this.fail('getYearlyReturn');
    return this.yearlyReturns[id.value] ?? null;
  }

  private fail(method: keyof ResearchRepository): void {
    const error = this.failures[method];
    if (error) throw error;
  }
}
