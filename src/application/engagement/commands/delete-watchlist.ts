import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';

const input = { id: idInput };

type Output = { id: string; deleted: true };

/** IBKR `delete_watchlist`. */
export class DeleteWatchlist extends Command<typeof input, Output> {
  readonly name = 'delete_watchlist';
  readonly title = 'Delete watchlist';
  readonly description = 'Deletes a watchlist permanently.';
  readonly context = 'engagement';
  readonly input = input;
  override readonly destructive = true;
  override readonly idempotent = true;

  constructor(private readonly deps: Pick<EngagementDependencies, 'repository'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const id = assertNonEmpty(params.id, 'Watchlist id');
    await this.deps.repository.deleteWatchlist(id);
    return { id, deleted: true };
  }
}
