import { describe, expect, it } from 'vitest';
import {
  aWatchlist,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { ValidationError } from '../../../../domain/shared-kernel/errors';
import { EditWatchlist } from '../edit-watchlist';

describe('EditWatchlist contract', () => {
  const uc = new EditWatchlist(engagementSetup());

  it('is the idempotent, non-destructive edit_watchlist command', () => {
    expect(uc).toMatchObject({
      name: 'edit_watchlist',
      kind: 'command',
      context: 'engagement',
      destructive: false,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['id', 'name', 'add', 'remove', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'wl-1', name: 'x', extra: 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ name: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: 'wl-1', add: 'COMI' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults add/remove to empty lists on egypt', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    const out = await new EditWatchlist(deps).run({ id: 'wl-1', name: 'Renamed' });
    expect(out).toEqual({ id: 'wl-1', renamed: true, name: 'Renamed', added: [], removed: [] });
  });
});

describe('EditWatchlist', () => {
  it('renames, adds and removes in that order and returns a receipt (no re-read)', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: ['COMI', 'GONE'] })] }),
    );
    const out = await new EditWatchlist(deps).execute({
      id: 'wl-1',
      name: 'Top',
      add: ['HRHO', 'hrho'],
      remove: [idFor('GONE'), 'COMI'],
    });
    expect(deps.repository.calls.renameWatchlist).toEqual([{ id: 'wl-1', name: 'Top' }]);
    expect(deps.repository.calls.addToWatchlist).toEqual([{ id: 'wl-1', ids: [idFor('HRHO')] }]);
    expect(deps.repository.calls.removeFromWatchlist).toEqual([
      { id: 'wl-1', ids: [idFor('GONE'), idFor('COMI')] },
    ]);
    expect(out).toEqual({
      id: 'wl-1',
      renamed: true,
      name: 'Top',
      added: [idFor('HRHO')],
      removed: [idFor('GONE'), idFor('COMI')],
    });
    expect(deps.repository.calls.getWatchlist).toEqual([]);
    // The unknown id was removed without an instrument lookup.
    expect(deps.market.calls.getInstrument.map((i) => i.value)).not.toContain(idFor('GONE'));
  });

  it('only adds', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: [] })] }));
    const out = await new EditWatchlist(deps).execute({ id: 'wl-1', add: ['ETEL'], market: 'egypt' });
    expect(deps.repository.calls.renameWatchlist).toEqual([]);
    expect(deps.repository.calls.removeFromWatchlist).toEqual([]);
    expect(out).toEqual({ id: 'wl-1', renamed: false, name: null, added: [idFor('ETEL')], removed: [] });
  });

  it('only renames', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    const out = await new EditWatchlist(deps).execute({ id: 'wl-1', name: 'Renamed', add: [], remove: [] });
    expect(deps.repository.calls.addToWatchlist).toEqual([]);
    expect(out).toEqual({ id: 'wl-1', renamed: true, name: 'Renamed', added: [], removed: [] });
  });

  it('rejects empty edits, conflicts and oversize lists without writing', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    const uc = new EditWatchlist(deps);
    await expect(uc.execute({ id: 'wl-1' })).rejects.toThrow('Nothing to change');
    await expect(uc.execute({ id: 'wl-1', add: ['COMI'], remove: [idFor('COMI')] })).rejects.toThrow(
      'both added and removed',
    );
    await expect(uc.execute({ id: 'wl-1', remove: Array.from({ length: 101 }, () => 'X') })).rejects.toThrow(
      'At most 100 symbols in "remove"',
    );
    await expect(uc.execute({ id: 'wl-1', name: '  ' })).rejects.toThrow(ValidationError);
    await expect(uc.execute({ id: '', name: 'x' })).rejects.toThrow('Watchlist id must not be empty');
    expect(deps.repository.calls.renameWatchlist).toEqual([]);
    expect(deps.repository.calls.addToWatchlist).toEqual([]);
  });
});
