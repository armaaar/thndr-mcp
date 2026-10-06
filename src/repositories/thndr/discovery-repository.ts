import { NotFoundError, UpstreamError } from '../../application/errors';
import type {
  DefaultMarketIndicatorsDto,
  DividendsResponseDto,
  RankedAssetsDto,
  TagDto,
  TagsResponseDto,
  TrendingAssetsDto,
  VisibleMarketsDto,
} from '../../data-sources/thndr/dto/discovery';
import type { ThndrHttpClient } from '../../data-sources/thndr/http-client';
import { assertNoKrakendError } from '../../data-sources/thndr/krakend';
import type { DividendPage, MarketAccess, MoverList, Tag, TagPage } from '../../domain/market-data/discovery';
import type {
  DiscoveryRepository,
  MoversQuery,
  PageQuery,
  TrendingQuery,
} from '../../domain/market-data/discovery-repository';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import { accountMarket, instrumentMarket } from './markets';
import {
  toDefaultIndicatorIds,
  toDividendPage,
  toListedInstrument,
  toMarketAccess,
  toMoverList,
  toTag,
  toTrendingIds,
} from './translators/discovery';
import { mapRows } from './translators/market-data';

const FEED = { include_feed: true, feed_detail: true } as const;
/** Thndr lists about twenty tags per market; one page of 100 holds them all. */
const TAGS_PAGE_SIZE = 100;

const isNotFound = (error: unknown) => error instanceof UpstreamError && error.status === 404;

/**
 * Adapter for the discovery endpoints of Thndr's mobile app (docs/api/mobile-app.md §1.3, §2.7, §2.8, §4.B;
 * ADR 0021). `api` targets https://prod.thndr.app; `appGateway` targets the app's KrakenD gateway
 * (https://prod.thndr.app/krakend-thndr-app), whose responses go through {@link assertNoKrakendError}. Both use the
 * full-access bearer token.
 */
export class ThndrDiscoveryRepository implements DiscoveryRepository {
  constructor(
    private readonly api: ThndrHttpClient,
    private readonly appGateway: ThndrHttpClient,
  ) {}

  async getVisibleMarkets(): Promise<MarketAccess> {
    return toMarketAccess(
      await this.api.get<VisibleMarketsDto>('/compliance-service/eligibilities/v2/visible-markets'),
    );
  }

  async getMovers(query: MoversQuery): Promise<MoverList> {
    const data = await this.api.get<RankedAssetsDto>('/assets-service/assets/rank', {
      query: {
        limit: query.limit,
        market: instrumentMarket(query.market),
        type: query.type === 'gainers' ? 'GAINERS' : 'LOSERS',
        duration: query.period,
        ...FEED,
      },
    });
    return toMoverList(data, query.market);
  }

  async getTrendingIds(query: TrendingQuery): Promise<AssetId[]> {
    const path = '/explore/v1/assets/trending';
    const data = await this.appGateway.get<TrendingAssetsDto>(path, {
      query: {
        market: accountMarket(query.market),
        count: query.count,
        asset_class: query.stocksOnly ? 'STOCK' : undefined,
      },
    });
    assertNoKrakendError(data, `GET ${path}`);
    return toTrendingIds(data);
  }

  async getDefaultIndicatorIds(market: Market): Promise<AssetId[]> {
    const path = '/explore/v1/default-market-indicators';
    const data = await this.appGateway.get<DefaultMarketIndicatorsDto>(path, {
      query: { market: accountMarket(market) },
    });
    assertNoKrakendError(data, `GET ${path}`);
    return toDefaultIndicatorIds(data);
  }

  async getTags(market: Market): Promise<Tag[]> {
    const data = await this.api.get<TagsResponseDto>('/assets-service/tags', {
      query: { page_count: TAGS_PAGE_SIZE, market: instrumentMarket(market) },
    });
    // Skip tags Thndr marks hidden.
    return mapRows(data?.results, (row) => (row?.hidden === true ? null : toTag(row)));
  }

  async getTagInstruments(tagId: string, market: Market, page: PageQuery): Promise<TagPage> {
    let data: TagDto | null;
    try {
      data = await this.api.get<TagDto>(`/assets-service/tags/${encodeURIComponent(tagId)}`, {
        query: { market: instrumentMarket(market), page_count: page.pageSize, page: page.page, ...FEED },
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // A 404 past the last page (Django pagination) is not an unknown tag: answer the tag with no instruments.
      if (page.page > 1) {
        const first = await this.getTagInstruments(tagId, market, { page: 1, pageSize: 1 });
        return Object.freeze({ tag: first.tag, instruments: Object.freeze([]) });
      }
      throw new NotFoundError(`No Thndr tag with id "${tagId}".`);
    }
    const tag = toTag(data && typeof data === 'object' ? { ...data, id: data.id ?? tagId } : null);
    if (!tag) throw new UpstreamError(`Unexpected tag payload from Thndr for ${tagId}`);
    return Object.freeze({
      tag,
      instruments: Object.freeze(mapRows(data?.assets, (row) => toListedInstrument(row, market))),
    });
  }

  async getDividends(id: AssetId, page: PageQuery): Promise<DividendPage> {
    try {
      const data = await this.api.get<DividendsResponseDto>(
        `/assets-service/assets/${encodeURIComponent(id.value)}/dividends`,
        { query: { page: page.page, page_count: page.pageSize } },
      );
      return toDividendPage(data);
    } catch (error) {
      // Django REST pagination answers 404 ("Invalid page") past the last page.
      if (page.page > 1 && isNotFound(error)) return toDividendPage({ results: [] });
      throw error;
    }
  }
}
