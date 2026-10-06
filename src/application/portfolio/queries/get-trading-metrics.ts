import { parseMarket } from '../../../domain/market-data/market';
import { parseMarketDate } from '../../../domain/market-data/market-calendar';
import {
  type InstrumentTradingStats,
  journalRange,
  type TradingMetrics,
} from '../../../domain/portfolio/journal';
import { dateInput, marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {
  market: marketInput,
  from: dateInput.optional(),
  to: dateInput.optional(),
};

export class GetTradingMetrics extends Query<typeof input, TradingMetrics> {
  readonly name = 'get_trading_metrics';
  readonly title = 'Trading performance metrics';
  readonly description =
    'Performance statistics: total return, win rate, profit factor, expectancy, average win/loss, risk/reward, ' +
    'average holding period, and per-instrument stats.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<TradingMetrics> {
    const range = journalRange(
      parseMarketDate(params.from, 'start'),
      parseMarketDate(params.to, 'end'),
      this.deps.clock.now(),
    );
    const market = parseMarket(params.market);
    const metrics = await this.deps.repository.getTradingMetrics(range);
    // Thndr keys per-symbol stats by asset id only: resolve tickers best-effort (cached by the resolver).
    const perInstrument = await Promise.all(
      metrics.perInstrument.map(async (stats): Promise<InstrumentTradingStats> => {
        if (stats.ticker || !stats.instrumentId) return stats;
        const ticker = await this.deps.resolver
          .resolve(stats.instrumentId.value, market)
          .then((instrument) => instrument.ticker)
          .catch(() => null);
        return Object.freeze({ ...stats, ticker });
      }),
    );
    perInstrument.sort((a, b) => (b.totalReturn ?? 0) - (a.totalReturn ?? 0));
    return Object.freeze({ overall: metrics.overall, perInstrument });
  }
}
