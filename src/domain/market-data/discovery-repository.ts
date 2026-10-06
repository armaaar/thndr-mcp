import type { AssetId } from '../shared-kernel/asset-id';
import type { Market } from '../shared-kernel/market';
import type {
  DividendPage,
  MarketAccess,
  MoverList,
  MoverPeriod,
  MoverType,
  Tag,
  TagPage,
} from './discovery';

export interface MoversQuery {
  market: Market;
  type: MoverType;
  period: MoverPeriod;
  limit: number;
}

export interface TrendingQuery {
  market: Market;
  count: number;
  /** Only stocks (Thndr's `asset_class=STOCK`); omit for every asset class. */
  stocksOnly?: boolean;
}

export interface PageQuery {
  /** 1-based. */
  page: number;
  pageSize: number;
}

/**
 * Discovery data from Thndr's mobile app endpoints (ADR 0021): the user's markets, movers, trending instruments,
 * default indices, tags and dividends.
 */
export interface DiscoveryRepository {
  /** The markets Thndr lists for the user, with restrictions and the default market. */
  getVisibleMarkets(): Promise<MarketAccess>;
  /** Top gainers or losers of a market over a period, best (or worst) first. */
  getMovers(query: MoversQuery): Promise<MoverList>;
  /** Ids of the instruments trending on Thndr in a market, most trending first. */
  getTrendingIds(query: TrendingQuery): Promise<AssetId[]>;
  /** Ids of the indices and benchmarks Thndr shows by default for a market (EGX30, SPY, FADGI…), in Thndr's order. */
  getDefaultIndicatorIds(market: Market): Promise<AssetId[]>;
  /** Thndr's tags (themes) for a market. */
  getTags(market: Market): Promise<Tag[]>;
  /** One tag with a page of its instruments; `NOT_FOUND` when the tag does not exist. */
  getTagInstruments(tagId: string, market: Market, page: PageQuery): Promise<TagPage>;
  /** A page of an instrument's dividends, newest first; empty when Thndr records none. */
  getDividends(id: AssetId, page: PageQuery): Promise<DividendPage>;
}
