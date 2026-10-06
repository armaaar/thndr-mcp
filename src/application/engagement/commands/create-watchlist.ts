import { WatchlistName } from '../../../domain/engagement/watchlist';
import { parseMarket } from '../../../domain/market-data/market';
import { marketInput } from '../../inputs';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { symbolsInput, watchlistNameInput } from '../inputs';
import { InstrumentLabeler } from '../services/instrument-labeler';
import { toWatchlistView, type WatchlistView } from '../views';
import { checkSymbolCount, resolveIds } from '../watchlist-symbols';

const input = { name: watchlistNameInput, symbols: symbolsInput.default([]), market: marketInput };

/** IBKR `create_watchlist`: creates a named watchlist, optionally seeded with symbols. */
export class CreateWatchlist extends Command<typeof input, WatchlistView> {
  readonly name = 'create_watchlist';
  readonly title = 'Create watchlist';
  readonly description =
    'Creates a watchlist, optionally pre-filled with instruments (tickers or asset ids).';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<WatchlistView> {
    const name = WatchlistName.of(params.name);
    const market = parseMarket(params.market);
    const ids = await resolveIds(this.deps, checkSymbolCount(params.symbols, 'symbols'), market);
    const created = await this.deps.repository.createWatchlist(name, market, ids);
    const labels = await InstrumentLabeler.for(this.deps).label(created.instrumentIds, market);
    return toWatchlistView(created, labels, market);
  }
}
