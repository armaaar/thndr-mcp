import type { Quote } from '../../../domain/market-data/instrument';
import type { MarketSession } from '../../../domain/market-data/order-book';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { market: marketInput };

export interface MarketStatus extends MarketSession {
  indices: Array<{
    ticker: string;
    level: number | null;
    changePercent: number | null;
    previousClose: number | null;
  }>;
}

export class GetMarketStatus extends Query<typeof input, MarketStatus> {
  readonly name = 'get_market_status';
  readonly title = 'Market status';
  readonly description =
    "Egypt, US and UAE (not the simulator): whether the market is open now, today's session open/close times and " +
    'the main index levels (EGX30, EGX70…). EGX regular session: Sunday–Thursday 10:00–14:30 Africa/Cairo; US: ' +
    '09:30–16:00 America/New_York.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<MarketStatus> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'marketStatus');
    const [session, indicators] = await Promise.all([
      this.deps.repository.getMarketSession(market),
      this.deps.repository.getMarketIndicators(market).catch(() => [] as Quote[]),
    ]);
    return {
      ...session,
      indices: indicators.map((q) => ({
        ticker: q.ticker.value,
        level: q.last,
        changePercent: q.changePercent,
        previousClose: q.previousClose,
      })),
    };
  }
}
