import { z } from 'zod';
import { MOVER_PERIODS, type MoverPeriod, type MoverType } from '../../../domain/market-data/discovery';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { type MoverView, toMoverView } from '../listing-views';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const input = {
  market: marketInput.describe('Market: "egypt" (default) or "us" (Thndr ranks no other market)'),
  type: z
    .enum(['gainers', 'losers', 'both'])
    .default('both')
    .describe('"gainers", "losers" or "both" (default)'),
  period: z
    .enum(MOVER_PERIODS)
    .default('1D')
    .describe('Ranking period: "1D" (default, today), "1W", "1M", "6M" or "1Y"'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Instruments per list (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
};

export interface MarketMoversView {
  market: Market;
  period: MoverPeriod;
  /** When Thndr last computed the ranking (null when it does not say). */
  updatedAt: string | null;
  gainers?: MoverView[];
  losers?: MoverView[];
}

export class GetMarketMovers extends Query<typeof input, MarketMoversView> {
  readonly name = 'get_market_movers';
  readonly title = 'Market movers';
  readonly description =
    'Thndr’s top gainers and/or losers of a market over a period (1D, 1W, 1M, 6M, 1Y), ranked by return, with ' +
    'each instrument’s price and today’s change. Egypt and US only. US lists can include instruments Thndr does not ' +
    'let you trade (`tradable: false`).';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<MarketMoversView> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'movers');
    const period = params.period ?? '1D';
    const limit = params.limit ?? DEFAULT_LIMIT;
    const types: MoverType[] =
      params.type === 'gainers' ? ['gainers'] : params.type === 'losers' ? ['losers'] : ['gainers', 'losers'];
    const lists = await Promise.all(
      types.map((type) => this.deps.discovery.getMovers({ market, type, period, limit })),
    );
    const updated = lists
      .map((list) => list.updatedAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const view: MarketMoversView = { market, period, updatedAt: updated?.toISOString() ?? null };
    types.forEach((type, index) => {
      view[type] = (lists[index]?.movers ?? []).slice(0, limit).map(toMoverView);
    });
    return view;
  }
}
