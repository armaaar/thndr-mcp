import type { AssetId } from '../shared-kernel/asset-id';
import type { Market } from '../shared-kernel/market';
import type { Ticker } from '../shared-kernel/ticker';
import type { FinancialMode, FinancialStatements } from './financials';
import type { EconomicIndicators, NewsLocale, NewsPage, YearlyReturn } from './research';

export interface NewsQuery {
  /** Omit for market-wide news. */
  assetId?: AssetId;
  /**
   * Market-wide news of one market (only the markets in `MARKET_NEWS_MARKETS`); without it, market-wide news is
   * Thndr's mixed feed of every market.
   */
  market?: Market;
  locale: NewsLocale;
  /** 1-based. */
  page: number;
}

/** Fundamentals, news and macro data Thndr serves for research (ADR 0018). */
export interface ResearchRepository {
  /**
   * Financial statements of one listed company. Rejects with a not-found error when Thndr has none for it.
   * `dataPointCount` asks for the most recent N periods only.
   */
  getFinancials(ticker: Ticker, mode: FinancialMode, dataPointCount?: number): Promise<FinancialStatements>;
  /** Financial statements of several companies in one call, keyed by ticker; companies without data are absent. */
  getFinancialsBatch(
    tickers: readonly Ticker[],
    mode: FinancialMode,
  ): Promise<Map<string, FinancialStatements>>;
  /** One page of news, for an instrument or market-wide, newest first. */
  getNews(query: NewsQuery): Promise<NewsPage>;
  /** Egypt's macroeconomic indicators. */
  getEconomicIndicators(): Promise<EconomicIndicators>;
  /** Thndr's own one-year return of an instrument, or null when Thndr gives none. */
  getYearlyReturn(id: AssetId): Promise<YearlyReturn | null>;
}
