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
    'value change, net deposits change, gain excluding deposits, time-weighted return %, change of Thndr’s total ' +
    'returns, ' +
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
        'Values are Thndr’s account value at each snapshot (positions plus cash).',
        'gainExcludingDeposits = valueChange − netDepositsChange. thndrTotalReturnsChange is the change of Thndr’s ' +
          '"total_returns" (account value − net deposits, unrealized gains included), so it normally equals ' +
          'gainExcludingDeposits; it is not realized profit.',
        'Time-weighted return chains r = (V_i − min(F,0)) / (V_(i−1) + max(F,0)) − 1 over consecutive snapshots ' +
          '(F = change of net deposits): deposits count from the start of the sub-period, withdrawals at its end; ' +
          'sub-periods with nothing at risk are skipped.',
        'Snapshots are daily (weekends included), so 1D compares the latest snapshot with the day before it. A ' +
          'period with a single snapshot (e.g. MTD on the 1st) has no figures.',
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
