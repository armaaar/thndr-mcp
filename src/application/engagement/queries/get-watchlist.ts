import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';
import { WatchlistReader } from '../services/watchlist-reader';
import type { WatchlistView } from '../views';

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
    return new WatchlistReader(this.deps).read(id, parseMarket(params.market));
  }
}
