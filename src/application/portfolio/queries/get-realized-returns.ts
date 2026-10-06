import { z } from 'zod';
import {
  parseReturnsInterval,
  RETURNS_INTERVALS,
  type RealizedReturns,
  type ReturnsInterval,
  type ReturnsPoint,
  type ReturnsSeriesSummary,
  summarizeReturnsSeries,
} from '../../../domain/portfolio/returns';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {
  market: marketInput,
  interval: z.enum(RETURNS_INTERVALS).default('1M'),
};

export interface RealizedReturnsResult {
  market: Market;
  current: RealizedReturns;
  interval: ReturnsInterval;
  series: ReturnsPoint[];
  seriesSummary: ReturnsSeriesSummary;
}

export class GetRealizedReturns extends Query<typeof input, RealizedReturnsResult> {
  readonly name = 'get_realized_returns';
  readonly title = 'Realized returns';
  readonly description =
    'Realized returns to date plus a portfolio value / returns series over 1M, 6M, 1Y or 2Y.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<RealizedReturnsResult> {
    const market = parseMarket(params.market);
    const interval = parseReturnsInterval(params.interval);
    const [current, series] = await Promise.all([
      this.deps.repository.getRealizedReturns(market),
      this.deps.repository.getReturnsChart(interval, market),
    ]);
    const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
    return { market, current, interval, series: sorted, seriesSummary: summarizeReturnsSeries(sorted) };
  }
}
