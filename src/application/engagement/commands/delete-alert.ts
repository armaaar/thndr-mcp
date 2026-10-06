import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';

const input = { id: idInput };

type Output = { id: string; deleted: true };

/** IBKR `delete_alert`. Idempotent. */
export class DeleteAlert extends Command<typeof input, Output> {
  readonly name = 'delete_alert';
  readonly title = 'Delete price alert';
  readonly description = 'Deletes a price alert.';
  readonly context = 'engagement';
  readonly input = input;
  override readonly destructive = true;
  override readonly idempotent = true;

  constructor(private readonly deps: Pick<EngagementDependencies, 'repository'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const id = assertNonEmpty(params.id, 'Alert id');
    await this.deps.repository.deletePriceAlert(id);
    return { id, deleted: true };
  }
}
