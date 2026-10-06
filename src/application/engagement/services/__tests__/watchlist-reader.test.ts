import { describe, expect, it } from 'vitest';
import {
  aWatchlist,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { WatchlistReader } from '../watchlist-reader';

describe('WatchlistReader', () => {
  it('reads a watchlist as a labelled view', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: ['COMI'] })] }),
    );
    const view = await new WatchlistReader(deps).read('wl-1', 'egypt');
    expect(view).toMatchObject({ id: 'wl-1', name: 'Banks', market: 'egypt' });
    expect(view.instruments.map((i) => i.ticker)).toEqual(['COMI']);
  });
});
