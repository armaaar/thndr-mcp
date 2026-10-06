import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type RecordedRequest } from '../../../__tests__/support/fake-fetch';
import { UpstreamError } from '../../../application/errors';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { WatchlistName } from '../../../domain/engagement/watchlist';
import { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ThndrEngagementRepository } from '../engagement-repository';
import { ThndrMarketDataRepository } from '../market-data-repository';
import { ThndrPortfolioRepository } from '../portfolio-repository';

const ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const API = 'https://api.test';
const tokens = { getAccessToken: async () => 'T', invalidate: () => {} };

/** The three Thndr repositories over one recorded fetch that answers every call with `answer(req)`. */
function setup(answer: (req: RecordedRequest) => Response = () => json({})) {
  const fetch = fakeFetch(answer);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, tokenProvider: tokens, runtimeVersion: '1' });
  const api = client(API);
  const krakend = client(`${API}/krakend-thndr-x`);
  const last = () => {
    const call = fetch.calls.at(-1) as RecordedRequest;
    const url = new URL(call.url);
    return { path: url.pathname, query: Object.fromEntries(url.searchParams), body: call.body };
  };
  return {
    fetch,
    last,
    portfolio: new ThndrPortfolioRepository(api, krakend),
    engagement: new ThndrEngagementRepository(api, krakend),
    market: new ThndrMarketDataRepository(api, krakend),
  };
}

describe('UAE account calls use Thndr’s `abudhabi` code', () => {
  it('wallet, position, sellable quantity, orders, returns and journal', async () => {
    const wallet = {
      market_name: 'abudhabi',
      purchase_power: 0,
      cash_in_holding: 0,
      settled_cash: 0,
      unsettled_cash: 0,
      portfolio: { portfolio_value: 0, total_return: 0, total_return_prc: 0, positions: [] },
    };
    const { portfolio, last } = setup((req) =>
      req.url.includes('wallet-and-portfolio') ? json(wallet) : json({}),
    );
    expect((await portfolio.getAccount('uae')).summary.currency).toBe('AED');
    expect(last()).toMatchObject({
      path: '/market-service/accounts/wallet-and-portfolio',
      query: { market: 'abudhabi' },
    });
    await portfolio.getPosition(AssetId.of(ID), 'uae');
    expect(last()).toMatchObject({
      path: `/krakend-thndr-x/portfolio/v1/position/${ID}`,
      query: { market: 'abudhabi' },
    });
    await portfolio.getSellableQuantity(AssetId.of(ID), 'uae');
    expect(last().query).toEqual({ market: 'abudhabi' });
    await portfolio.listOrders({ market: 'uae', status: 'all', limit: 5 });
    expect(last()).toMatchObject({ path: '/market-service/v3/orders', query: { market: 'abudhabi' } });
    await portfolio.getRealizedReturns('uae');
    expect(last()).toMatchObject({ path: '/market-service/realized-returns', query: { market: 'abudhabi' } });
    await portfolio.getReturnsChart('1M', 'uae');
    expect(last().query).toEqual({ market: 'abudhabi' });
    await portfolio.getClosedTrades({ market: 'uae', page: 1, limit: 5 });
    expect(last().query).toMatchObject({ market: 'abudhabi' });
    await portfolio.getSellJournal({ market: 'uae', page: 1, limit: 5 });
    expect(last().query).toMatchObject({ market: 'abudhabi' });
  });

  it('activity uses the ADX_UAE provider, and the simulator makes no call', async () => {
    const { portfolio, last, fetch } = setup(() => json({ results: [] }));
    await portfolio.listActivities('uae', 1, 10);
    expect(last()).toMatchObject({
      path: '/funding-service/account-activities',
      query: { provider: 'ADX_UAE' },
    });
    const before = fetch.calls.length;
    expect(await portfolio.listActivities('simulator', 2, 10)).toEqual({
      activities: [],
      page: 2,
      hasMore: false,
    });
    expect(fetch.calls).toHaveLength(before);
  });

  it('watchlists, price alerts and screeners', async () => {
    const { engagement, market, last } = setup(() => json({ id: 'w1', results: [], watchlists: [] }));
    await engagement.listWatchlists('uae');
    expect(last()).toMatchObject({ path: '/users-service/watchlists', query: { market: 'abudhabi' } });
    await engagement.createWatchlist(WatchlistName.of('Gulf'), 'uae', [AssetId.of(ID)]);
    expect(last().body).toMatchObject({ market: 'abudhabi', name: 'Gulf' });
    await engagement.listPriceAlerts('us', { page: 1, pageCount: 5 });
    expect(last().query).toMatchObject({ market: 'us' });
    await engagement.listPriceAlerts('uae', { page: 1, pageCount: 5 });
    expect(last().query).toMatchObject({ market: 'abudhabi' });
    await engagement.createPriceAlert({
      instrumentId: AssetId.of(ID),
      price: 10,
      direction: 'UP',
      frequency: 'ONE_TIME',
      market: 'uae',
    });
    expect(last().body).toMatchObject({ market: 'abudhabi' });
    await market.getScreeners('uae');
    expect(last()).toMatchObject({ path: '/users-service/screeners', query: { market: 'abudhabi' } });
  });
});

describe('UAE instrument calls use Thndr’s `adsm` code', () => {
  it('search, marketwatch, indicators and similar stocks', async () => {
    const { market, last } = setup(() => json({ assets: [], results: [] }));
    await market.searchInstruments('bank', 'uae');
    expect(last()).toMatchObject({ path: '/assets-service/assets/search', query: { market: 'adsm' } });
    await market.getMarketQuotes('uae');
    expect(last()).toMatchObject({ path: '/assets-service/assets/marketwatch', query: { market: 'adsm' } });
    await market.getMarketIndicators('uae');
    expect(last().query).toMatchObject({ market: 'adsm' });
    await market.getSimilarInstruments(AssetId.of(ID), 'uae', 3);
    expect(last()).toMatchObject({
      path: `/assets-service/assets/${ID}/recommendations`,
      query: { market: 'adsm' },
    });
  });
});

describe('returns history of an account without snapshots', () => {
  it('reads Thndr’s 404 as an empty history and propagates other errors', async () => {
    const empty = setup(() => json({ detail: { msg: 'Latest Snapshot Not Found' } }, 404));
    expect(await empty.portfolio.getRealizedReturns('us')).toEqual({
      totalReturns: null,
      snapshotDate: null,
    });
    expect(await empty.portfolio.getReturnsChart('6M', 'us')).toEqual([]);
    const broken = setup(() => json({ detail: { msg: 'boom' } }, 500));
    await expect(broken.portfolio.getRealizedReturns('us')).rejects.toBeInstanceOf(UpstreamError);
    await expect(broken.portfolio.getReturnsChart('1M', 'us')).rejects.toMatchObject({ status: 500 });
  });
});
