import { z } from 'zod';
import { type OrderBook, spread } from '../../../domain/market-data/order-book';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { dataMarket } from '../services/snapshot-market';

const input = {
  symbol: symbolInput,
  market: marketInput,
  levels: z.number().int().min(1).max(50).default(10),
};

export type MarketDepth = OrderBook & { ticker: string; spread: ReturnType<typeof spread> };

export class GetMarketDepth extends Query<typeof input, MarketDepth> {
  readonly name = 'get_market_depth';
  readonly title = 'Market depth';
  readonly description =
    'Egypt only: order book (bids and asks aggregated by price level with order counts) and the bid/ask spread.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<MarketDepth> {
    const instrument = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    requireMarketFeature(dataMarket(instrument.market), 'orderBook');
    const book = await this.deps.repository.getOrderBook(instrument.id);
    const levels = Math.min(Math.max(params.levels ?? 10, 1), 50);
    const trimmed: OrderBook = {
      ...book,
      bids: book.bids.slice(0, levels),
      asks: book.asks.slice(0, levels),
    };
    return { ticker: instrument.ticker.value, ...trimmed, spread: spread(book) };
  }
}
