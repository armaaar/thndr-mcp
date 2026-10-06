import { uniqueAssetIds, WatchlistName } from '../../../domain/engagement/watchlist';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput, symbolsInput, watchlistNameInput } from '../inputs';
import { assetIdOrNull } from '../services/instrument-labels';
import { checkSymbolCount, resolveIds } from '../watchlist-symbols';

const input = {
  id: idInput,
  name: watchlistNameInput.optional(),
  add: symbolsInput.default([]),
  remove: symbolsInput.default([]),
  market: marketInput,
};

/** CQS receipt: what changed. Use `get_watchlist` to read the updated list. */
export type WatchlistEdited = {
  id: string;
  renamed: boolean;
  name: string | null;
  added: string[];
  removed: string[];
};

/**
 * IBKR `edit_watchlist`: rename and/or add and remove instruments in one call, applied in that order. Removals accept tickers or raw asset ids (ids of delisted instruments
 * are removed without a lookup).
 */
export class EditWatchlist extends Command<typeof input, WatchlistEdited> {
  readonly name = 'edit_watchlist';
  readonly title = 'Edit watchlist';
  readonly description =
    'Renames a watchlist and/or adds and removes instruments in one call. Returns what changed; read the list with get_watchlist.';
  readonly context = 'engagement';
  readonly input = input;
  override readonly idempotent = true;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<WatchlistEdited> {
    const id = assertNonEmpty(params.id, 'Watchlist id');
    const market = parseMarket(params.market);
    const name = params.name === undefined ? null : WatchlistName.of(params.name);
    const addSymbols = checkSymbolCount(params.add, 'add');
    const removeSymbols = checkSymbolCount(params.remove, 'remove');
    if (!name && addSymbols.length === 0 && removeSymbols.length === 0) {
      throw new ValidationError('Nothing to change: provide a new name, symbols to add or symbols to remove');
    }
    const [add, remove] = await Promise.all([
      resolveIds(this.deps, addSymbols, market),
      Promise.all(
        removeSymbols.map(async (s) => assetIdOrNull(s) ?? (await this.deps.resolver.resolve(s, market)).id),
      ).then(uniqueAssetIds),
    ]);
    const conflict = add.find((a) => remove.some((r) => r.equals(a)));
    if (conflict) {
      throw new ValidationError(`Instrument ${conflict.value} is both added and removed; pick one`);
    }
    if (name) await this.deps.repository.renameWatchlist(id, name);
    if (add.length > 0) await this.deps.repository.addToWatchlist(id, add);
    if (remove.length > 0) await this.deps.repository.removeFromWatchlist(id, remove);
    return {
      id,
      renamed: name !== null,
      name: name?.value ?? null,
      added: add.map((a) => a.value),
      removed: remove.map((r) => r.value),
    };
  }
}
