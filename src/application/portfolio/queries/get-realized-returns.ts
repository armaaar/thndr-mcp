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
import { requireMarketFeature } from '../../market-features';
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
    'Thndr\'s cumulative return to date (its "realized returns": account value minus net deposits, unrealized ' +
    'gains included) plus a series of account value, net deposits and returns over 1M, 6M, 1Y or 2Y.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<RealizedReturnsResult> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'returns');
    const interval = parseReturnsInterval(params.interval);
    const [current, series] = await Promise.all([
      this.deps.repository.getRealizedReturns(market),
      this.deps.repository.getReturnsChart(interval, market),
    ]);
    const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
    return { market, current, interval, series: sorted, seriesSummary: summarizeReturnsSeries(sorted) };
  }
}
