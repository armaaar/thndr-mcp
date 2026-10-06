import { describe, expect, it } from 'vitest';
import {
  aWatchlist,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { ValidationError } from '../../../../domain/shared-kernel/errors';
import { GetWatchlist } from '../get-watchlist';

describe('GetWatchlist contract', () => {
  const uc = new GetWatchlist(engagementSetup());

  it('is the get_watchlist query', () => {
    expect(uc).toMatchObject({ name: 'get_watchlist', kind: 'query', context: 'engagement' });
    expect(Object.keys(uc.input)).toEqual(['id', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'wl-1', extra: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults the market to egypt', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    expect(await new GetWatchlist(deps).run({ id: 'wl-1' })).toMatchObject({ id: 'wl-1', market: 'egypt' });
  });
});

describe('GetWatchlist', () => {
  it('reads the detail, borrows the name from the list and adds live prices', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: ['HRHO', 'GONE'] })] }),
    );
    const out = await new GetWatchlist(deps).execute({ id: ' wl-1 ' });
    expect(deps.repository.calls.getWatchlist).toEqual(['wl-1']);
    expect(out).toEqual({
      id: 'wl-1',
      name: 'Banks',
      color: 'color_4',
      icon: 'thndr',
      count: 2,
      market: 'egypt',
      instruments: [
        { instrumentId: idFor('HRHO'), ticker: 'HRHO', name: 'HRHO Corp', last: 101, changePercent: 1 },
        { instrumentId: idFor('GONE'), ticker: null, name: null, last: null, changePercent: null },
      ],
    });
  });

  it('keeps an empty name when the list misses it or fails', async () => {
    const repository = new FakeEngagementRepository({ watchlists: [aWatchlist()] });
    const deps = engagementSetup(repository);
    repository.failures.listWatchlists = new Error('down');
    expect((await new GetWatchlist(deps).execute({ id: 'wl-1' })).name).toBe('');
    delete repository.failures.listWatchlists;
    repository.getWatchlist = async () => aWatchlist({ id: 'other', name: '' });
    expect(await new GetWatchlist(deps).execute({ id: 'other' })).toMatchObject({ id: 'other', name: '' });
  });

  it('skips the list lookup when the detail has a name', async () => {
    const repository = new FakeEngagementRepository();
    repository.getWatchlist = async () => aWatchlist({ name: 'Detail' });
    const deps = engagementSetup(repository);
    expect((await new GetWatchlist(deps).execute({ id: 'wl-1', market: 'EGYPT' as never })).name).toBe(
      'Detail',
    );
    expect(repository.calls.listWatchlists).toEqual([]);
  });

  it('validates the id', async () => {
    await expect(new GetWatchlist(engagementSetup()).execute({ id: ' ' })).rejects.toThrow(ValidationError);
  });
});
