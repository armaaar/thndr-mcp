import { describe, expect, it } from 'vitest';
import { CreateWatchlist } from '../../../../src/application/engagement/commands/create-watchlist';
import { NotFoundError } from '../../../../src/application/errors';
import { engagementSetup } from '../../../support/fake-engagement';
import { idFor } from '../../../support/fake-market-data';

describe('CreateWatchlist contract', () => {
  const uc = new CreateWatchlist(engagementSetup());

  it('is the create_watchlist command, neither destructive nor idempotent', () => {
    expect(uc).toMatchObject({
      name: 'create_watchlist',
      kind: 'command',
      context: 'engagement',
      destructive: false,
      idempotent: false,
    });
    expect(Object.keys(uc.input)).toEqual(['name', 'symbols', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ name: 'x', extra: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ name: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ name: 'x'.repeat(51) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      uc.run({ name: 'x', symbols: Array.from({ length: 101 }, () => 'COMI') }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults to no symbols on egypt', async () => {
    const deps = engagementSetup();
    await new CreateWatchlist(deps).run({ name: 'Empty' });
    expect(deps.repository.calls.createWatchlist).toEqual([{ name: 'Empty', market: 'egypt', ids: [] }]);
  });
});

describe('CreateWatchlist', () => {
  it('resolves and dedupes symbols, then creates', async () => {
    const deps = engagementSetup();
    const out = await new CreateWatchlist(deps).execute({
      name: ' Banks ',
      symbols: ['comi', 'HRHO', idFor('COMI')],
    });
    expect(deps.repository.calls.createWatchlist).toEqual([
      { name: 'Banks', market: 'egypt', ids: [idFor('COMI'), idFor('HRHO')] },
    ]);
    expect(out).toMatchObject({ id: 'wl-100', name: 'Banks', count: 2, market: 'egypt' });
    expect(out.instruments.map((i) => i.ticker)).toEqual(['COMI', 'HRHO']);
  });

  it('creates an empty watchlist', async () => {
    const deps = engagementSetup();
    const out = await new CreateWatchlist(deps).execute({ name: 'Empty', market: 'us' });
    expect(deps.repository.calls.createWatchlist).toEqual([{ name: 'Empty', market: 'us', ids: [] }]);
    expect(out.instruments).toEqual([]);
  });

  it('validates the name, symbol count and symbols before writing', async () => {
    const deps = engagementSetup();
    const uc = new CreateWatchlist(deps);
    await expect(uc.execute({ name: '' })).rejects.toThrow('Watchlist name must not be empty');
    await expect(
      uc.execute({ name: 'x', symbols: Array.from({ length: 101 }, () => 'COMI') }),
    ).rejects.toThrow('At most 100 symbols in "symbols"');
    await expect(uc.execute({ name: 'x', symbols: ['NOPE'] })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.createWatchlist).toEqual([]);
  });
});
