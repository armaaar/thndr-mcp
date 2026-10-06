import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { InstrumentLabeler } from '../services/instrument-labeler';
import { toSummaryView, type WatchlistSummaryView } from '../views';

const input = { market: marketInput };

type Output = { market: Market; watchlists: WatchlistSummaryView[] };

/** IBKR `get_watchlists`: every custom watchlist of a market with its tickers. */
export class GetWatchlists extends Query<typeof input, Output> {
  readonly name = 'get_watchlists';
  readonly title = 'Watchlists';
  readonly description =
    'All custom watchlists of the Thndr account with their instruments (tickers and asset ids).';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'watchlists');
    const watchlists = await this.deps.repository.listWatchlists(market);
    const labels = await InstrumentLabeler.for(this.deps).label(
      watchlists.flatMap((w) => w.instrumentIds),
      market,
    );
    return {
      market,
      watchlists: watchlists.map((w) => toSummaryView(w, labels)),
    };
  }
}
