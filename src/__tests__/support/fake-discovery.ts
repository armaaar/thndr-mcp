import { NotFoundError } from '../../application/errors';
import type {
  Dividend,
  DividendPage,
  ListedInstrument,
  MarketAccess,
  Mover,
  MoverList,
  Tag,
  TagPage,
} from '../../domain/market-data/discovery';
import type {
  DiscoveryRepository,
  MoversQuery,
  PageQuery,
  TrendingQuery,
} from '../../domain/market-data/discovery-repository';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import { anInstrument } from './fake-market-data';

export function aListedInstrument(
  ticker = 'COMI',
  overrides: Partial<ListedInstrument> = {},
): ListedInstrument {
  return {
    instrument: anInstrument({ ticker }),
    price: 100,
    previousClose: 98,
    changePercent: 2.04,
    ...overrides,
  };
}

export function aMover(ticker: string, returnPercent: number, overrides: Partial<Mover> = {}): Mover {
  return { ...aListedInstrument(ticker), returnPercent, ...overrides };
}

export function aTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: '157',
    slug: 'sharia',
    name: 'Sharia',
    about: 'Screened in accordance with Sharia principles.',
    instrumentCount: 89,
    featured: true,
    ...overrides,
  };
}

export function aDividend(overrides: Partial<Dividend> = {}): Dividend {
  return {
    id: '1086',
    type: 'CASH',
    status: 'PAST',
    recordDate: '2026-04-06',
    ratio: 6,
    currency: 'EGP',
    frequency: 'ONE_TIME',
    couponNumber: null,
    distributions: [{ date: '2026-04-09', ratio: 6 }],
    ...overrides,
  };
}

/** In-memory DiscoveryRepository: seed per market (or tag/asset id), inspect the calls, inject failures. */
export class FakeDiscoveryRepository implements DiscoveryRepository {
  access: MarketAccess = {
    markets: [
      { market: 'egypt', restricted: false, restrictionReason: null },
      { market: 'us', restricted: false, restrictionReason: null },
    ],
    defaultMarket: 'egypt',
    otherMarkets: [],
  };
  /** `${market}:${type}` → list. */
  movers: Record<string, MoverList> = {};
  trending: Partial<Record<Market, AssetId[]>> = {};
  defaultIndicators: Partial<Record<Market, AssetId[]>> = {};
  tags: Partial<Record<Market, Tag[]>> = {};
  /** Tag id → its instruments (every page). */
  tagInstruments: Record<string, ListedInstrument[]> = {};
  /** Asset id → dividends (every page). */
  dividends: Record<string, Dividend[]> = {};
  failures: Partial<Record<keyof DiscoveryRepository, Error>> = {};

  readonly calls = {
    getVisibleMarkets: 0,
    getMovers: [] as MoversQuery[],
    getTrendingIds: [] as TrendingQuery[],
    getDefaultIndicatorIds: [] as Market[],
    getTags: [] as Market[],
    getTagInstruments: [] as Array<{ tagId: string; market: Market } & PageQuery>,
    getDividends: [] as Array<{ id: string } & PageQuery>,
  };

  async getVisibleMarkets(): Promise<MarketAccess> {
    this.calls.getVisibleMarkets++;
    this.fail('getVisibleMarkets');
    return this.access;
  }

  async getMovers(query: MoversQuery): Promise<MoverList> {
    this.calls.getMovers.push(query);
    this.fail('getMovers');
    return this.movers[`${query.market}:${query.type}`] ?? { movers: [], updatedAt: null };
  }

  async getTrendingIds(query: TrendingQuery): Promise<AssetId[]> {
    this.calls.getTrendingIds.push(query);
    this.fail('getTrendingIds');
    return this.trending[query.market] ?? [];
  }

  async getDefaultIndicatorIds(market: Market): Promise<AssetId[]> {
    this.calls.getDefaultIndicatorIds.push(market);
    this.fail('getDefaultIndicatorIds');
    return this.defaultIndicators[market] ?? [];
  }

  async getTags(market: Market): Promise<Tag[]> {
    this.calls.getTags.push(market);
    this.fail('getTags');
    return this.tags[market] ?? [];
  }

  async getTagInstruments(tagId: string, market: Market, page: PageQuery): Promise<TagPage> {
    this.calls.getTagInstruments.push({ tagId, market, ...page });
    this.fail('getTagInstruments');
    const tag = (this.tags[market] ?? []).find((t) => t.id === tagId);
    if (!tag) throw new NotFoundError(`No Thndr tag with id "${tagId}".`);
    const all = this.tagInstruments[tagId] ?? [];
    const start = (page.page - 1) * page.pageSize;
    return { tag, instruments: all.slice(start, start + page.pageSize) };
  }

  async getDividends(id: AssetId, page: PageQuery): Promise<DividendPage> {
    this.calls.getDividends.push({ id: id.value, ...page });
    this.fail('getDividends');
    const all = this.dividends[id.value] ?? [];
    const start = (page.page - 1) * page.pageSize;
    return { dividends: all.slice(start, start + page.pageSize), total: all.length };
  }

  private fail(method: keyof DiscoveryRepository): void {
    const error = this.failures[method];
    if (error) throw error;
  }
}
