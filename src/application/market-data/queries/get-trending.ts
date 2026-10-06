import { z } from 'zod';
import { type AssetClass, type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_LIMIT = 10;
/** Each trending id costs one instrument lookup (cached afterwards): keep the list short. */
const MAX_LIMIT = 20;

const input = {
  market: marketInput.describe('Market: "egypt" (default), "us" or "uae"'),
  stocksOnly: z.boolean().default(false).describe('Only stocks (no ETFs or funds)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Number of instruments (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
};

export interface TrendingItemView {
  rank: number;
  instrumentId: string;
  /** Null when the instrument's details could not be loaded. */
  ticker: string | null;
  name: string | null;
  assetClass: AssetClass | null;
  sector: string | null;
}

export interface TrendingView {
  market: Market;
  stocksOnly: boolean;
  items: TrendingItemView[];
}

export class GetTrending extends Query<typeof input, TrendingView> {
  readonly name = 'get_trending';
  readonly title = 'Trending instruments';
  readonly description =
    'The instruments trending on Thndr in a market (Egypt, US or UAE), most trending first, as the app’s Explore ' +
    'tab shows them: ticker, name, asset class and sector. Use get_price_snapshot for their prices.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<TrendingView> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'trending');
    const limit = params.limit ?? DEFAULT_LIMIT;
    const stocksOnly = params.stocksOnly ?? false;
    const ids = (await this.deps.discovery.getTrendingIds({ market, count: limit, stocksOnly })).slice(
      0,
      limit,
    );
    // Names only enrich the list: an instrument whose details fail keeps its id.
    const details = await Promise.allSettled(ids.map((id) => this.deps.resolver.resolve(id.value, market)));
    return {
      market,
      stocksOnly,
      items: ids.map((id, index) => {
        const found = details[index];
        const instrument = found?.status === 'fulfilled' ? found.value : null;
        return {
          rank: index + 1,
          instrumentId: id.value,
          ticker: instrument?.ticker.value ?? null,
          name: instrument?.name ?? null,
          assetClass: instrument?.assetClass ?? null,
          sector: instrument?.sector ?? null,
        };
      }),
    };
  }
}
