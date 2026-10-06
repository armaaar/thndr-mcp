import type { Watchlist } from '../../../domain/engagement/watchlist';
import { parseMarket } from '../../../domain/market-data/market';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';
import { InstrumentLabeler } from '../services/instrument-labeler';
import { toWatchlistView, type WatchlistView } from '../views';

const input = { id: idInput, market: marketInput };

/** IBKR `get_watchlist`: one watchlist with tickers, names and live prices. */
export class GetWatchlist extends Query<typeof input, WatchlistView> {
  readonly name = 'get_watchlist';
  readonly title = 'Watchlist';
  readonly description = 'One watchlist by id with its instruments.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<WatchlistView> {
    const id = assertNonEmpty(params.id, 'Watchlist id');
    const market = parseMarket(params.market);
    let watchlist = await this.deps.repository.getWatchlist(id);
    if (watchlist.name === '') {
      // The detail endpoint only returns `asset_ids`: borrow the name/colour/icon from the list.
      const summaries = await this.deps.repository.listWatchlists(market).catch(() => [] as Watchlist[]);
      const summary = summaries.find((w) => w.id === watchlist.id);
      if (summary) watchlist = { ...summary, instrumentIds: watchlist.instrumentIds };
    }
    const labels = await InstrumentLabeler.for(this.deps).label(watchlist.instrumentIds, market);
    return toWatchlistView(watchlist, labels, market);
  }
}
