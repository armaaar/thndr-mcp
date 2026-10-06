import { describe, expect, it } from 'vitest';
import {
  aWatchlist,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { GetWatchlists } from '../get-watchlists';

describe('GetWatchlists contract', () => {
  const uc = new GetWatchlists(engagementSetup());

  it('is the get_watchlists query', () => {
    expect(uc).toMatchObject({ name: 'get_watchlists', kind: 'query', context: 'engagement' });
    expect(Object.keys(uc.input)).toEqual(['market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ market: 'egypt', extra: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults the market to egypt', async () => {
    const deps = engagementSetup();
    expect(await new GetWatchlists(deps).run(undefined)).toEqual({ market: 'egypt', watchlists: [] });
    expect(deps.repository.calls.listWatchlists).toEqual(['egypt']);
  });
});

describe('GetWatchlists', () => {
  it('lists watchlists of the default market with tickers', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({
        watchlists: [aWatchlist({ tickers: ['COMI', 'EGX30'] }), aWatchlist({ id: 'wl-2', tickers: [] })],
      }),
    );
    const out = await new GetWatchlists(deps).execute({});
    expect(deps.repository.calls.listWatchlists).toEqual(['egypt']);
    expect(out).toEqual({
      market: 'egypt',
      watchlists: [
        {
          id: 'wl-1',
          name: 'Banks',
          color: 'color_4',
          icon: 'thndr',
          count: 2,
          instruments: [
            { instrumentId: idFor('COMI'), ticker: 'COMI' },
            { instrumentId: idFor('EGX30'), ticker: 'EGX30' },
          ],
        },
        { id: 'wl-2', name: 'Banks', color: 'color_4', icon: 'thndr', count: 0, instruments: [] },
      ],
    });
  });

  it('parses the market', async () => {
    const deps = engagementSetup();
    expect((await new GetWatchlists(deps).execute({ market: 'USA' as never })).market).toBe('us');
  });
});
