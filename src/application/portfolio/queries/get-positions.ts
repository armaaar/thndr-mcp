import { z } from 'zod';
import type { AccountSummary } from '../../../domain/portfolio/account-summary';
import {
  type AllocationSummary,
  computeAllocation,
  type Position,
  positionWeight,
} from '../../../domain/portfolio/position';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

export const POSITION_SORT_FIELDS = [
  'marketValue',
  'unrealizedPnl',
  'unrealizedPnlPercent',
  'costValue',
  'ticker',
] as const;
export type PositionSortField = (typeof POSITION_SORT_FIELDS)[number];

const input = {
  market: marketInput,
  sortBy: z.enum(POSITION_SORT_FIELDS).default('marketValue'),
  order: z.enum(['asc', 'desc']).default('desc'),
};

export interface PositionsResult {
  market: Market;
  currency: AccountSummary['currency'];
  portfolioValue: number;
  totalReturn: number | null;
  totalReturnPercent: number | null;
  positions: Array<Position & { weightPercent: number }>;
  allocation: AllocationSummary;
}

export class GetPositions extends Query<typeof input, PositionsResult> {
  readonly name = 'get_account_positions';
  readonly title = 'Positions';
  readonly description =
    'All holdings with quantity, average cost, market price and value, unrealized P/L, portfolio weight and ' +
    'allocation by asset class.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PositionsResult> {
    const market = parseMarket(params.market);
    const { summary, positions } = await this.deps.repository.getAccount(market);
    const allocation = computeAllocation(positions, summary.portfolioValue);
    const sortBy = params.sortBy ?? 'marketValue';
    const direction = params.order === 'asc' ? 1 : -1;
    const rows = positions.map((p) => ({
      ...p,
      weightPercent: positionWeight(p.marketValue, allocation.basis),
    }));
    rows.sort((a, b) => {
      if (sortBy === 'ticker') return a.ticker.value.localeCompare(b.ticker.value) * direction;
      const x = a[sortBy];
      const y = b[sortBy];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction;
    });
    return {
      market,
      currency: summary.currency,
      portfolioValue: summary.portfolioValue,
      totalReturn: summary.totalReturn,
      totalReturnPercent: summary.totalReturnPercent,
      positions: rows,
      allocation,
    };
  }
}
