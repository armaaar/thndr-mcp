import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type Responder } from '../../../__tests__/support/fake-fetch';
import { NotFoundError, UpstreamError } from '../../../application/errors';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ThndrDiscoveryRepository } from '../discovery-repository';

const API = 'https://prod.thndr.app';
const GW = 'https://prod.thndr.app/krakend-thndr-app';
const COMI = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const tokens = { getAccessToken: async () => 'TOKEN', invalidate: () => {} };

function setup(...responders: Responder[]) {
  const fetch = fakeFetch(...responders);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, tokenProvider: tokens, runtimeVersion: '3.8.3' });
  return { fetch, repo: new ThndrDiscoveryRepository(client(API), client(GW)) };
}

const krakendError = (key: string) =>
  json({
    [key]: { http_status_code: 422, http_body: JSON.stringify({ detail: { msg: 'bad market', type: 'X' } }) },
  });

/** A synthetic ranked/listed asset in Thndr's shape (fields trimmed). */
function asset(
  symbol: string,
  id: string,
  feed: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    symbol,
    name: `${symbol} Holding`,
    asset_class: 'STOCK',
    market: 'egypt',
    currency: 'EGP',
    industry: 'Capital Goods',
    is_tradable: true,
    tags: null,
    feed: { last_trade_price: 105.7, price: 105.7, previous_close: 95.44, last_change_prc: 10.75, ...feed },
    ...extra,
  };
}

describe('ThndrDiscoveryRepository', () => {
  describe('getVisibleMarkets', () => {
    it('maps Thndr market names to domain markets and keeps unknown ones aside', async () => {
      const { fetch, repo } = setup(() =>
        json({
          markets: [
            { name: 'egypt', is_restricted: false, restriction_reason: null },
            { name: 'us', is_restricted: true, restriction_reason: 'USER_UNDER_ELIGIBLE_AGE' },
            { name: 'abudhabi', is_restricted: false },
            { name: 'adsm' },
            { name: 'tdwl' },
            { name: 'tdwl' },
            { name: '' },
            null,
            { name: 'simulator', is_restricted: false },
          ],
          default_market: 'abudhabi',
        }),
      );
      const out = await repo.getVisibleMarkets();
      expect(fetch.calls[0]?.url).toBe(`${API}/compliance-service/eligibilities/v2/visible-markets`);
      expect(fetch.calls[0]?.headers.authorization).toBe('Bearer TOKEN');
      expect(out).toEqual({
        markets: [
          { market: 'egypt', restricted: false, restrictionReason: null },
          { market: 'us', restricted: true, restrictionReason: 'USER_UNDER_ELIGIBLE_AGE' },
          { market: 'uae', restricted: false, restrictionReason: null },
          { market: 'simulator', restricted: false, restrictionReason: null },
        ],
        defaultMarket: 'uae',
        otherMarkets: ['tdwl'],
      });
    });

    it('tolerates an empty payload', async () => {
      const out = await setup(() => json({})).repo.getVisibleMarkets();
      expect(out).toEqual({ markets: [], defaultMarket: null, otherMarkets: [] });
    });
  });

  describe('getMovers', () => {
    it('asks for the ranking with the feed and maps the return, price and change', async () => {
      const { fetch, repo } = setup(() =>
        json({
          assets_ranked: [
            { ...asset('DAPH', ID_A), id: undefined, asset_id: ID_A, asset_return_percentage: 10.75 },
            asset(
              'GNLN',
              ID_B,
              { last_trade_price: null, price: 0, previous_close: null, last_change_prc: null },
              {
                market: 'us',
                currency: 'USD',
                is_tradable: false,
                asset_return_percentage: '-94.9',
              },
            ),
            { symbol: 'BAD' },
            null,
          ],
          last_updated_at: '2026-10-06T14:00:25.700000Z',
        }),
      );
      const out = await repo.getMovers({ market: 'egypt', type: 'gainers', period: '1W', limit: 5 });
      expect(fetch.calls[0]?.url).toBe(
        `${API}/assets-service/assets/rank?limit=5&market=egypt&type=GAINERS&duration=1W&include_feed=true&feed_detail=true`,
      );
      expect(out.updatedAt?.toISOString()).toBe('2026-10-06T14:00:25.700Z');
      expect(out.movers).toHaveLength(2);
      expect(out.movers[0]).toMatchObject({
        returnPercent: 10.75,
        price: 105.7,
        previousClose: 95.44,
        changePercent: 10.75,
      });
      expect(out.movers[0]?.instrument).toMatchObject({ name: 'DAPH Holding', sector: 'Capital Goods' });
      expect(out.movers[0]?.instrument.id.value).toBe(ID_A);
      expect(out.movers[1]).toMatchObject({ returnPercent: -94.9, price: null, previousClose: null });
      expect(out.movers[1]?.instrument).toMatchObject({ market: 'us', currency: 'USD', tradable: false });
    });

    it('asks for losers in the US with the instrument market code', async () => {
      const { fetch, repo } = setup(() => json({ last_updated_at: null }));
      const out = await repo.getMovers({ market: 'us', type: 'losers', period: '1D', limit: 3 });
      expect(new URL(fetch.calls[0]?.url ?? '').searchParams.get('type')).toBe('LOSERS');
      expect(new URL(fetch.calls[0]?.url ?? '').searchParams.get('market')).toBe('us');
      expect(out).toEqual({ movers: [], updatedAt: null });
    });
  });

  describe('getTrendingIds', () => {
    it('asks the app gateway with the account market code and keeps valid, distinct ids', async () => {
      const { fetch, repo } = setup(() => json({ results: [ID_A, 'nope', ID_A.toUpperCase(), null, ID_B] }));
      const out = await repo.getTrendingIds({ market: 'uae', count: 5, stocksOnly: true });
      expect(fetch.calls[0]?.url).toBe(
        `${GW}/explore/v1/assets/trending?market=abudhabi&count=5&asset_class=STOCK`,
      );
      expect(fetch.calls[0]?.headers.authorization).toBe('Bearer TOKEN');
      expect(out.map((id) => id.value)).toEqual([ID_A, ID_B]);
    });

    it('omits the asset class by default and surfaces KrakenD errors', async () => {
      const ok = setup(() => json({}));
      expect(await ok.repo.getTrendingIds({ market: 'egypt', count: 3 })).toEqual([]);
      expect(ok.fetch.calls[0]?.url).toBe(`${GW}/explore/v1/assets/trending?market=egypt&count=3`);
      await expect(
        setup(() => krakendError('error_get_trending_assets')).repo.getTrendingIds({
          market: 'us',
          count: 3,
        }),
      ).rejects.toThrow(UpstreamError);
    });
  });

  describe('getDefaultIndicatorIds', () => {
    it('reads the object form (live) for the account market code', async () => {
      const { fetch, repo } = setup(() =>
        json({
          default_market_indicators: {
            indicators: [{ asset_id: ID_A }, { asset_id: 'x' }, null, { asset_id: ID_B }],
          },
        }),
      );
      const out = await repo.getDefaultIndicatorIds('uae');
      expect(fetch.calls[0]?.url).toBe(`${GW}/explore/v1/default-market-indicators?market=abudhabi`);
      expect(out.map((id) => id.value)).toEqual([ID_A, ID_B]);
    });

    it('also reads a list of groups and an empty answer, and surfaces KrakenD errors', async () => {
      const list = setup(() =>
        json({
          default_market_indicators: [
            { indicators: [{ asset_id: ID_B }] },
            null,
            { indicators: [{ asset_id: ID_B }] },
          ],
        }),
      );
      expect((await list.repo.getDefaultIndicatorIds('us')).map((id) => id.value)).toEqual([ID_B]);
      expect(await setup(() => json({})).repo.getDefaultIndicatorIds('egypt')).toEqual([]);
      await expect(
        setup(() => krakendError('error_get_default_market_indicators')).repo.getDefaultIndicatorIds('us'),
      ).rejects.toThrow(UpstreamError);
    });
  });

  describe('getTags', () => {
    it('lists the visible tags of a market', async () => {
      const { fetch, repo } = setup(() =>
        json({
          count: 4,
          results: [
            {
              id: 179,
              market: 'egypt',
              slug: 'gold',
              name: 'Gold Funds',
              about: 'The tried and tested investment.',
              assets_count: 4,
              assets: [],
              hidden: null,
              is_featured: false,
            },
            { id: 157, slug: 'sharia', name: 'Sharia', about: '', assets_count: '89', is_featured: true },
            { id: 1, name: 'Hidden', hidden: true },
            { id: 2, name: '  ' },
          ],
        }),
      );
      const out = await repo.getTags('egypt');
      expect(fetch.calls[0]?.url).toBe(`${API}/assets-service/tags?page_count=100&market=egypt`);
      expect(out).toEqual([
        {
          id: '179',
          slug: 'gold',
          name: 'Gold Funds',
          about: 'The tried and tested investment.',
          instrumentCount: 4,
          featured: false,
        },
        { id: '157', slug: 'sharia', name: 'Sharia', about: null, instrumentCount: 89, featured: true },
      ]);
    });

    it('tolerates an empty answer', async () => {
      expect(await setup(() => json({})).repo.getTags('us')).toEqual([]);
    });
  });

  describe('getTagInstruments', () => {
    it('asks for one page of the tag with the feed and maps its instruments', async () => {
      const { fetch, repo } = setup(() =>
        json({
          id: 157,
          slug: 'sharia',
          name: 'Sharia',
          assets_count: 89,
          hidden: false,
          assets: [asset('AALR', ID_A, { last_trade_price: 265.53 }), { id: 'bad' }],
        }),
      );
      const out = await repo.getTagInstruments('157', 'egypt', { page: 2, pageSize: 5 });
      expect(fetch.calls[0]?.url).toBe(
        `${API}/assets-service/tags/157?market=egypt&page_count=5&page=2&include_feed=true&feed_detail=true`,
      );
      expect(out.tag).toMatchObject({ id: '157', name: 'Sharia', instrumentCount: 89 });
      expect(out.instruments).toHaveLength(1);
      expect(out.instruments[0]).toMatchObject({ price: 265.53 });
      expect(out.instruments[0]?.instrument.ticker.value).toBe('AALR');
    });

    it('falls back to the requested id, and maps a 404 to NOT_FOUND', async () => {
      const ok = setup(() => json({ name: 'Sharia' }));
      expect((await ok.repo.getTagInstruments('157', 'us', { page: 1, pageSize: 20 })).tag.id).toBe('157');
      await expect(
        setup(() => json({ detail: 'Not found.' }, 404)).repo.getTagInstruments('9', 'egypt', {
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toThrow(new NotFoundError('No Thndr tag with id "9".'));
    });

    it('answers the tag with no instruments past its last page, and NOT_FOUND for an unknown tag', async () => {
      const gone = () => json({ detail: 'Invalid page.' }, 404);
      const past = setup(gone, () => json({ id: 157, name: 'Sharia', assets: [asset('AALR', ID_A)] }));
      const out = await past.repo.getTagInstruments('157', 'egypt', { page: 9, pageSize: 20 });
      expect(out.tag.name).toBe('Sharia');
      expect(out.instruments).toEqual([]);
      expect(past.fetch.calls[1]?.url).toContain('page_count=1&page=1');
      await expect(
        setup(gone).repo.getTagInstruments('9', 'egypt', { page: 2, pageSize: 20 }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects an unexpected payload and lets other errors through', async () => {
      await expect(
        setup(() => json(null)).repo.getTagInstruments('157', 'egypt', { page: 1, pageSize: 20 }),
      ).rejects.toThrow(UpstreamError);
      await expect(
        setup(() => json({ detail: 'no' }, 403)).repo.getTagInstruments('157', 'egypt', {
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('getDividends', () => {
    it('asks for one page of the dividends and maps cash and stock dividends', async () => {
      const { fetch, repo } = setup(() =>
        json({
          results: [
            {
              id: 1086,
              asset_id: COMI,
              dividend_type: 'CASH',
              record_date: '2026-04-06',
              distributions: [{ ratio: 6, date: '2026-04-09' }, null],
              currency: 'EGP',
              coupon_number: null,
              frequency: 'ONE_TIME',
              status: 'PAST',
              ratio: 6,
            },
            {
              id: 1063,
              dividend_type: 'stock',
              record_date: '2025-12-16T00:00:00Z',
              distributions: [{ amount: '0.1', date: 'soon' }],
              currency: 'XYZ',
              coupon_number: 47,
              status: 'UPCOMING',
              ratio: '0.1',
            },
            { id: 3, dividend_type: 'SPECIAL', status: 'LATER' },
            { dividend_type: 'CASH' },
          ],
          page: 1,
          page_count: 5,
          total_count: 7,
        }),
      );
      const out = await repo.getDividends(AssetId.of(COMI), { page: 1, pageSize: 5 });
      expect(fetch.calls[0]?.url).toBe(`${API}/assets-service/assets/${COMI}/dividends?page=1&page_count=5`);
      expect(out.total).toBe(7);
      expect(out.dividends).toEqual([
        {
          id: '1086',
          type: 'CASH',
          status: 'PAST',
          recordDate: '2026-04-06',
          ratio: 6,
          currency: 'EGP',
          frequency: 'ONE_TIME',
          couponNumber: null,
          distributions: [{ date: '2026-04-09', ratio: 6 }],
        },
        {
          id: '1063',
          type: 'STOCK',
          status: 'UPCOMING',
          recordDate: '2025-12-16',
          ratio: 0.1,
          currency: null,
          frequency: null,
          couponNumber: '47',
          distributions: [{ date: null, ratio: 0.1 }],
        },
        {
          id: '3',
          type: 'UNKNOWN',
          status: 'UNKNOWN',
          recordDate: null,
          ratio: null,
          currency: null,
          frequency: null,
          couponNumber: null,
          distributions: [],
        },
      ]);
    });

    it('answers an empty page past the last one, but not for the first page', async () => {
      const gone = () => json({ detail: 'Invalid page.' }, 404);
      expect(await setup(gone).repo.getDividends(AssetId.of(COMI), { page: 3, pageSize: 5 })).toEqual({
        dividends: [],
        total: null,
      });
      await expect(setup(gone).repo.getDividends(AssetId.of(COMI), { page: 1, pageSize: 5 })).rejects.toThrow(
        UpstreamError,
      );
      expect(
        await setup(() => json({ results: [] })).repo.getDividends(AssetId.of(COMI), {
          page: 1,
          pageSize: 5,
        }),
      ).toEqual({
        dividends: [],
        total: null,
      });
    });
  });
});
