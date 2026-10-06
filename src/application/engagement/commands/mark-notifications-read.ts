import { z } from 'zod';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { Command, type InputOf } from '../../use-case';
import { MAX_NOTIFICATION_IDS_PER_CALL } from '../constants';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';

const input = {
  ids: z.array(idInput).max(MAX_NOTIFICATION_IDS_PER_CALL).default([]),
  all: z.boolean().default(false),
};

type Output = { all: boolean; ids: string[] };

/** Marks the given notifications — or all of them — as read. */
export class MarkNotificationsRead extends Command<typeof input, Output> {
  readonly name = 'mark_notifications_read';
  readonly title = 'Mark notifications read';
  readonly description = 'Marks the given notification ids as read, or all of them with all=true.';
  readonly context = 'engagement';
  readonly input = input;
  override readonly idempotent = true;

  constructor(private readonly deps: Pick<EngagementDependencies, 'repository'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const ids = [...new Set((params.ids ?? []).map((id) => assertNonEmpty(id, 'Notification id')))];
    if (params.all === true) {
      if (ids.length > 0) throw new ValidationError('Pass either ids or all=true, not both');
      await this.deps.repository.markAllNotificationsRead();
      return { all: true, ids: [] };
    }
    if (ids.length === 0) throw new ValidationError('Provide notification ids, or all=true');
    if (ids.length > MAX_NOTIFICATION_IDS_PER_CALL) {
      throw new ValidationError(`At most ${MAX_NOTIFICATION_IDS_PER_CALL} notification ids per call`);
    }
    await this.deps.repository.markNotificationsRead(ids);
    return { all: false, ids };
  }
}
