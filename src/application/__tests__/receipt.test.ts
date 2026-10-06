import { describe, expect, it } from 'vitest';
import { Command, type Receipt } from '../use-case';

/** CQS is type-enforced: a command's output must be a flat `Receipt`, never a read model. */
abstract class NoInputCommand<Output extends Receipt> extends Command<Record<string, never>, Output> {
  readonly name = 'noop';
  readonly title = 'Noop';
  readonly description = 'Noop';
  readonly context = 'engagement' as const;
  readonly input = {};
}

class FlatReceipt extends NoInputCommand<{ id: string; ids: readonly string[]; done: boolean }> {
  async execute() {
    return { id: 'x', ids: ['a'], done: true };
  }
}

interface WatchlistModel {
  id: string;
}

// @ts-expect-error a nested object is a read model, not a receipt
type Nested = NoInputCommand<{ watchlist: { id: string } }>;
// @ts-expect-error an array of objects is not a receipt
type ArrayOfObjects = NoInputCommand<{ items: Array<{ id: string }> }>;
// @ts-expect-error an interface has no index signature, so it cannot be a receipt
type FromInterface = NoInputCommand<WatchlistModel>;

describe('Receipt', () => {
  it('accepts a flat acknowledgement', async () => {
    const rejected: Array<Nested | ArrayOfObjects | FromInterface> = [];
    expect(rejected).toEqual([]);
    await expect(new FlatReceipt().run({})).resolves.toEqual({ id: 'x', ids: ['a'], done: true });
  });
});
