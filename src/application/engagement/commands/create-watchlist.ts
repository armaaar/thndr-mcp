import { WatchlistName } from '../../../domain/engagement/watchlist';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { symbolsInput, watchlistNameInput } from '../inputs';
import { checkSymbolCount, resolveIds } from '../watchlist-symbols';

const input = { name: watchlistNameInput, symbols: symbolsInput.default([]), market: marketInput };

/** CQS receipt: what was created. Use `get_watchlist` to read the list with tickers and prices. */
export type WatchlistCreated = { id: string; name: string; instrumentIds: string[] };

/** IBKR `create_watchlist`: creates a named watchlist, optionally seeded with symbols. */
export class CreateWatchlist extends Command<typeof input, WatchlistCreated> {
  readonly name = 'create_watchlist';
  readonly title = 'Create watchlist';
  readonly description =
    'Creates a watchlist, optionally pre-filled with instruments (tickers or asset ids). Returns the new id; read the list with get_watchlist.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<WatchlistCreated> {
    const name = WatchlistName.of(params.name);
    const market = parseMarket(params.market);
    const ids = await resolveIds(this.deps, checkSymbolCount(params.symbols, 'symbols'), market);
    const created = await this.deps.repository.createWatchlist(name, market, ids);
    return { id: created.id, name: created.name, instrumentIds: created.instrumentIds.map((i) => i.value) };
  }
}
