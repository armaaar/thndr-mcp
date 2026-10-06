import { NotFoundError, UpstreamError } from '../../application/errors';
import type {
  AssetYearlyReturnDto,
  FinancialsBatchDto,
  FinancialsDto,
  MacrosDto,
  NewsResponseDto,
} from '../../data-sources/thndr/dto/research';
import type { ThndrHttpClient } from '../../data-sources/thndr/http-client';
import { assertNoKrakendError } from '../../data-sources/thndr/krakend';
import type { FinancialMode, FinancialStatements } from '../../domain/market-data/financials';
import type { EconomicIndicators, NewsPage, YearlyReturn } from '../../domain/market-data/research';
import type { NewsQuery, ResearchRepository } from '../../domain/market-data/research-repository';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import type { Ticker } from '../../domain/shared-kernel/ticker';
import { accountMarket } from './markets';
import {
  toEconomicIndicators,
  toFinancialStatements,
  toFinancialsBatch,
  toNewsPage,
  toYearlyReturn,
} from './translators/research';

const isNotFound = (error: unknown) => error instanceof UpstreamError && error.status === 404;
/** Articles per page, as Thndr's legacy news feed serves them. */
const NEWS_PAGE_SIZE = 25;

/**
 * Adapter for Thndr's research data (docs/api/market-data.md §8, ADR 0018). `api` targets https://prod.thndr.app
 * (news, asset details); `web` targets https://x.thndr.app/api (ThndrX's own routes: financials, macros) and
 * `gateway` the mobile app's KrakenD (https://prod.thndr.app/krakend-thndr-app: per-market news), all with the
 * full-access bearer token.
 */
export class ThndrResearchRepository implements ResearchRepository {
  constructor(
    private readonly api: ThndrHttpClient,
    private readonly web: ThndrHttpClient,
    private readonly gateway: ThndrHttpClient,
  ) {}

  async getFinancials(
    ticker: Ticker,
    mode: FinancialMode,
    dataPointCount?: number,
  ): Promise<FinancialStatements> {
    let data: FinancialsDto;
    try {
      data = await this.web.get<FinancialsDto>('/financials', {
        query: { symbol: ticker.value, mode, dataPointCount },
      });
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundError(`Thndr has no financials for ${ticker.value}.`);
      throw error;
    }
    const statements = toFinancialStatements(data, mode);
    if (Object.keys(statements.series).length === 0) {
      throw new NotFoundError(`Thndr has no financials for ${ticker.value}.`);
    }
    return statements;
  }

  async getFinancialsBatch(
    tickers: readonly Ticker[],
    mode: FinancialMode,
  ): Promise<Map<string, FinancialStatements>> {
    if (tickers.length === 0) return new Map();
    try {
      const data = await this.web.get<FinancialsBatchDto>('/financials', {
        query: { symbols: tickers.map((t) => t.value).join(','), mode },
      });
      return toFinancialsBatch(data, mode);
    } catch (error) {
      // ThndrX treats a failed batch as "no data" ({}); a 404 means none of the symbols is known.
      if (isNotFound(error)) return new Map();
      throw error;
    }
  }

  async getNews(query: NewsQuery): Promise<NewsPage> {
    try {
      if (query.market && !query.assetId) return await this.getMarketNews(query.market, query.page);
      const data = await this.api.get<NewsResponseDto>('/api/post/news/', {
        query: { asset_id: query.assetId?.value, locale: query.locale, page: query.page },
      });
      return toNewsPage(data);
    } catch (error) {
      // Django REST pagination answers 404 ("Invalid page") past the last page.
      if (query.page > 1 && isNotFound(error)) return toNewsPage({ results: [] });
      throw error;
    }
  }

  /** The gateway's market news (docs/api/mobile-app.md §2.6; same item shape as the legacy feed, live 2026-10-06). */
  private async getMarketNews(market: Market, page: number): Promise<NewsPage> {
    const path = '/news/v1/market';
    const data = await this.gateway.get<NewsResponseDto>(path, {
      query: { markets: accountMarket(market), page, page_size: NEWS_PAGE_SIZE },
    });
    assertNoKrakendError(data, `GET ${path}`);
    return toNewsPage(data);
  }

  async getEconomicIndicators(): Promise<EconomicIndicators> {
    return toEconomicIndicators(await this.web.get<MacrosDto>('/macros'));
  }

  async getYearlyReturn(id: AssetId): Promise<YearlyReturn | null> {
    const data = await this.api.get<AssetYearlyReturnDto>(
      `/assets-service/assets/${encodeURIComponent(id.value)}`,
      {
        query: { include_yearly_return: true },
      },
    );
    return toYearlyReturn(data);
  }
}
