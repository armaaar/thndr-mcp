import { z } from 'zod';
import { ORDER_STATUS_FILTERS, type Order, parseOrderStatusFilter } from '../../../domain/portfolio/order';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { clamp } from '../../paging';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {
  market: marketInput,
  status: z.enum(ORDER_STATUS_FILTERS).default('all'),
  symbol: z.string().optional().describe('Only orders for this ticker'),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional().describe('nextCursor from a previous call'),
  oldestFirst: z.boolean().default(false),
};

export interface OrdersResult {
  market: Market;
  status: string;
  orders: Order[];
  nextCursor: string | null;
}

export class ListOrders extends Query<typeof input, OrdersResult> {
  /** ThndrX pages orders by 10 or 20; we never ask for more per request. */
  static readonly PAGE_SIZE = 20;

  readonly name = 'get_account_orders';
  readonly title = 'Orders';
  readonly description =
    'Order history and status (open, completed, cancelled, closed): side, type, quantity, filled quantity, ' +
    'price, validity, brackets. Read-only — this server cannot place, change or cancel orders.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<OrdersResult> {
    const market = parseMarket(params.market);
    const status = parseOrderStatusFilter(params.status);
    const limit = clamp(params.limit, 20, 1, 100);
    const instrumentId = params.symbol
      ? (await this.deps.resolver.resolve(params.symbol, market)).id
      : undefined;
    const orders: Order[] = [];
    let cursor: string | null = params.cursor || null;
    let first = true;
    // Never over-fetch: each request asks for at most what is still missing, so `nextCursor` stays exact.
    while (orders.length < limit && (first || cursor !== null)) {
      const page = await this.deps.repository.listOrders({
        market,
        status,
        limit: Math.min(limit - orders.length, ListOrders.PAGE_SIZE),
        sortOrder: params.oldestFirst ? 'ASC' : 'DESC',
        ...(cursor ? { cursor } : {}),
        ...(instrumentId ? { instrumentId } : {}),
      });
      first = false;
      orders.push(...page.orders);
      cursor = page.nextCursor;
      if (page.orders.length === 0) break;
    }
    return { market, status, orders, nextCursor: cursor };
  }
}
