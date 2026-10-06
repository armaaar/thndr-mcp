import { describe, expect, it } from 'vitest';
import { DeleteWatchlist } from '../../../../src/application/engagement/commands/delete-watchlist';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { aWatchlist, engagementSetup, FakeEngagementRepository } from '../../../support/fake-engagement';

describe('DeleteWatchlist contract', () => {
  const uc = new DeleteWatchlist(engagementSetup());

  it('is the destructive, idempotent delete_watchlist command', () => {
    expect(uc).toMatchObject({
      name: 'delete_watchlist',
      kind: 'command',
      context: 'engagement',
      destructive: true,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['id']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'wl-1', market: 'egypt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run(undefined)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('DeleteWatchlist', () => {
  it('deletes by id', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    expect(await new DeleteWatchlist(deps).execute({ id: ' wl-1 ' })).toEqual({ id: 'wl-1', deleted: true });
    expect(deps.repository.calls.deleteWatchlist).toEqual(['wl-1']);
    await expect(new DeleteWatchlist(deps).execute({ id: '' })).rejects.toThrow(ValidationError);
  });
});
