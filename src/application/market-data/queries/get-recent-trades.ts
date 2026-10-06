import { z } from 'zod';
import type { TapeTrade } from '../../../domain/market-data/order-book';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { dataMarket } from '../services/snapshot-market';

const input = {
  symbol: symbolInput,
  market: marketInput,
  limit: z.number().int().min(1).max(200).default(50),
  before: z.string().optional().describe('Cursor from a previous call (nextCursor)'),
};

export interface RecentTrades {
  ticker: string;
  trades: TapeTrade[];
  nextCursor: string | null;
}

export class GetRecentTrades extends Query<typeof input, RecentTrades> {
  readonly name = 'get_recent_trades';
  readonly title = 'Recent trades (time & sales)';
  readonly description =
    'Egypt only: latest executed trades for an instrument. Use `before` with the returned nextCursor to page back.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<RecentTrades> {
    const instrument = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    requireMarketFeature(dataMarket(instrument.market), 'orderBook');
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const trades = await this.deps.repository.getRecentTrades(instrument.id, limit, params.before);
    return { ticker: instrument.ticker.value, trades, nextCursor: trades.at(-1)?.cursor ?? null };
  }
}
