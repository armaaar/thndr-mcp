import { z } from 'zod';
import type {
  GetAccountSummary,
  GetClosedTrades,
  GetPosition,
  GetPositions,
  GetRealizedReturns,
  GetSellJournal,
  GetTradingMetrics,
  ListAccountActivity,
  ListOrders,
} from '../../application/portfolio/use-cases.js';
import { POSITION_SORT_FIELDS } from '../../application/portfolio/use-cases.js';
import { ACTIVITY_CATEGORIES } from '../../domain/portfolio/activity.js';
import { ORDER_STATUS_FILTERS } from '../../domain/portfolio/order.js';
import { RETURNS_INTERVALS } from '../../domain/portfolio/returns.js';
import { dateArg, parseDateArg } from './dates.js';
import { market, symbol } from './market-data.js';
import { type AnyTool, defineTool, READ_ONLY } from './operation.js';

export interface PortfolioUseCases {
  getAccountSummary: GetAccountSummary;
  getPositions: GetPositions;
  getPosition: GetPosition;
  listOrders: ListOrders;
  getRealizedReturns: GetRealizedReturns;
  getClosedTrades: GetClosedTrades;
  getSellJournal: GetSellJournal;
  getTradingMetrics: GetTradingMetrics;
  listAccountActivity: ListAccountActivity;
}

const journalInput = {
  market,
  symbol: z.string().optional().describe('Only this ticker'),
  from: dateArg.optional(),
  to: dateArg.optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
};

export function portfolioTools(useCases: PortfolioUseCases): AnyTool[] {
  return [
    defineTool({
      name: 'get_account_summary',
      title: 'Account summary',
      description:
        'Cash and value of the Thndr account: buying power, blocked cash (reserved by open buy orders), unsettled ' +
        'cash, available cash, portfolio market value, total return and total account value.',
      input: { market },
      annotations: READ_ONLY,
      handler: ({ market: m }) => useCases.getAccountSummary.execute({ market: m }),
    }),
    defineTool({
      name: 'get_account_positions',
      title: 'Positions',
      description:
        'All holdings with quantity, average cost, market price and value, unrealized P/L, portfolio weight and ' +
        'allocation by asset class.',
      input: {
        market,
        sort_by: z.enum(POSITION_SORT_FIELDS).default('marketValue'),
        order: z.enum(['asc', 'desc']).default('desc'),
      },
      annotations: READ_ONLY,
      handler: ({ market: m, sort_by, order }) =>
        useCases.getPositions.execute({ market: m, sortBy: sort_by, order }),
    }),
    defineTool({
      name: 'get_position',
      title: 'Position in one instrument',
      description:
        'The holding in one instrument (or held=false). With include_sellable=true also returns how many shares ' +
        'can be sold now per settlement cycle (T0, T1, T+2).',
      input: { symbol, market, include_sellable: z.boolean().default(false) },
      annotations: READ_ONLY,
      handler: ({ symbol: s, market: m, include_sellable }) =>
        useCases.getPosition.execute({ symbol: s, market: m, includeSellable: include_sellable }),
    }),
    defineTool({
      name: 'get_account_orders',
      title: 'Orders',
      description:
        'Order history and status (open, completed, cancelled, closed): side, type, quantity, filled quantity, ' +
        'price, validity, brackets. Read-only — this server cannot place, change or cancel orders.',
      input: {
        market,
        status: z.enum(ORDER_STATUS_FILTERS).default('all'),
        symbol: z.string().optional().describe('Only orders for this ticker'),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional().describe('nextCursor from a previous call'),
        oldest_first: z.boolean().default(false),
      },
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.listOrders.execute({
          market: a.market,
          status: a.status,
          symbol: a.symbol,
          limit: a.limit,
          cursor: a.cursor,
          oldestFirst: a.oldest_first,
        }),
    }),
    defineTool({
      name: 'get_realized_returns',
      title: 'Realized returns',
      description: 'Realized returns to date plus a portfolio value / returns series over 1M, 6M, 1Y or 2Y.',
      input: { market, interval: z.enum(RETURNS_INTERVALS).default('1M') },
      annotations: READ_ONLY,
      handler: ({ market: m, interval }) => useCases.getRealizedReturns.execute({ market: m, interval }),
    }),
    defineTool({
      name: 'get_closed_trades',
      title: 'Closed trades (journal)',
      description:
        'Trading journal of round trips: entry/exit dates and prices, volume, net P/L and holding period.',
      input: journalInput,
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.getClosedTrades.execute({
          ...a,
          from: parseDateArg(a.from, 'start'),
          to: parseDateArg(a.to, 'end'),
        }),
    }),
    defineTool({
      name: 'get_sell_journal',
      title: 'Sell journal',
      description: 'Each sell execution with exit price, volume, average entry price and net P/L.',
      input: journalInput,
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.getSellJournal.execute({
          ...a,
          from: parseDateArg(a.from, 'start'),
          to: parseDateArg(a.to, 'end'),
        }),
    }),
    defineTool({
      name: 'get_trading_metrics',
      title: 'Trading performance metrics',
      description:
        'Performance statistics: total return, win rate, profit factor, expectancy, average win/loss, risk/reward, ' +
        'average holding period, and per-instrument stats.',
      input: { market, from: dateArg.optional(), to: dateArg.optional() },
      annotations: READ_ONLY,
      handler: ({ market: m, from, to }) =>
        useCases.getTradingMetrics.execute({
          market: m,
          from: parseDateArg(from, 'start'),
          to: parseDateArg(to, 'end'),
        }),
    }),
    defineTool({
      name: 'get_account_activity',
      title: 'Account activity',
      description: 'Cash ledger: deposits, withdrawals, order settlements, dividends, fees and transfers.',
      input: {
        market,
        category: z.enum(ACTIVITY_CATEGORIES).optional(),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
      handler: ({ market: m, category, page, page_size }) =>
        useCases.listAccountActivity.execute({ market: m, category, page, pageSize: page_size }),
    }),
  ];
}
