import type { Watchlist } from '../../../domain/engagement/watchlist';
import type { Market } from '../../../domain/shared-kernel/market';
import type { EngagementDependencies } from '../dependencies';
import { toWatchlistView, type WatchlistView } from '../views';
import { InstrumentLabeler } from './instrument-labeler';

/** Application service shared by the watchlist use cases: loads one watchlist as a labelled view. */
export class WatchlistReader {
  constructor(private readonly deps: EngagementDependencies) {}

  async read(id: string, market: Market): Promise<WatchlistView> {
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
