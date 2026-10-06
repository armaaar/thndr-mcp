import { type AccountSummary, accountCurrency } from '../../../domain/portfolio/account-summary';
import {
  mergeReturnsSeries,
  PERFORMANCE_PERIODS,
  type PeriodPerformance,
  periodBaseDay,
  periodPerformance,
} from '../../../domain/portfolio/performance';
import { marketDay } from '../../../domain/portfolio/period';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = { market: marketInput };

export interface SeriesCoverage {
  /** Thndr chart interval the series came from. */
  interval: '6M' | '2Y';
  granularity: 'daily' | 'weekly';
  from: Date | null;
  to: Date | null;
  points: number;
}

export interface PortfolioPerformanceResult {
  market: Market;
  currency: AccountSummary['currency'];
  /** Date of the latest snapshot every period ends on. */
  asOf: Date | null;
  periods: PeriodPerformance[];
  series: SeriesCoverage[];
  method: string[];
}

/**
 * Portfolio performance per period from Thndr's returns chart. Two calls cover every period: the daily `6M` series
 * (which contains `1M`) and the weekly `2Y` series (which contains `1Y`); weekly points are used only before the
 * daily series starts.
 */
export class GetPortfolioPerformance extends Query<typeof input, PortfolioPerformanceResult> {
  readonly name = 'get_portfolio_performance';
  readonly title = 'Portfolio performance';
  readonly description =
    "Portfolio performance for 1D, 7D, MTD, 1M, 6M, YTD, 1Y and 2Y from Thndr's returns chart: start/end value, " +
    'value change, net deposits change, gain excluding deposits, time-weighted return %, realized returns change, ' +
    'the dates and series granularity (daily/weekly) used, and whether the period is only partly covered.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PortfolioPerformanceResult> {
    const market = parseMarket(params.market);
    const [daily, weekly] = await Promise.all([
      this.deps.repository.getReturnsChart('6M', market),
      this.deps.repository.getReturnsChart('2Y', market),
    ]);
    const timeline = mergeReturnsSeries(daily, weekly);
    const today = marketDay(this.deps.clock.now());
    const end = timeline.at(-1);
    const endDay = end?.day ?? today;
    return {
      market,
      currency: accountCurrency(market),
      asOf: end?.date ?? null,
      periods: PERFORMANCE_PERIODS.map((period) =>
        periodPerformance(period, timeline, periodBaseDay(period, endDay, today)),
      ),
      series: [coverage('6M', 'daily', daily), coverage('2Y', 'weekly', weekly)],
      method: [
        'Base of a period = the last snapshot on or before the close before its first day (rolling periods count ' +
          'back from the latest snapshot; MTD/YTD start on the 1st in Cairo time). If the series starts later, ' +
          'its first snapshot is used and the period is marked partial.',
        'gainExcludingDeposits = valueChange − netDepositsChange.',
        'Time-weighted return chains r = (V_i − ΔD_i) / V_(i−1) − 1 over consecutive snapshots, assuming deposits ' +
          'and withdrawals arrive at the end of each sub-period; sub-periods starting from a value ≤ 0 are skipped.',
        'Weekly snapshots (2Y series) are used only before the daily 6M series starts, so long periods are ' +
          'approximations at weekly granularity.',
      ],
    };
  }
}

function coverage(
  interval: SeriesCoverage['interval'],
  granularity: SeriesCoverage['granularity'],
  points: readonly { date: Date }[],
): SeriesCoverage {
  const times = points.map((p) => p.date.getTime());
  return {
    interval,
    granularity,
    from: times.length ? new Date(Math.min(...times)) : null,
    to: times.length ? new Date(Math.max(...times)) : null,
    points: points.length,
  };
}
