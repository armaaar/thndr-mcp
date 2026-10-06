import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../../src/application/errors.js';
import { AssetId } from '../../../src/domain/market-data/asset-id.js';
import { ThndrHttpClient } from '../../../src/infrastructure/thndr/http-client.js';
import { HttpMarketDataGateway } from '../../../src/infrastructure/thndr/market-data-gateway.js';
import { fakeFetch, json, type Responder } from '../../support/fake-fetch.js';

const ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const OTHER = 'b0a4c53e-b12f-4e93-b94b-759b8eeaef14';
const API = 'https://prod.thndr.app';
const KRAKEND = 'https://prod.thndr.app/krakend-thndr-x';

const tokens = { getAccessToken: async () => 'TOKEN', invalidate: () => {} };

function setup(...responders: Responder[]) {
  const fetch = fakeFetch(...responders);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({
      baseUrl,
      fetch,
      tokenProvider: tokens,
      runtimeVersion: '3.8.3',
      correlationId: () => 'cid',
    });
  return { fetch, gateway: new HttpMarketDataGateway(client(API), client(KRAKEND)) };
}

function url(raw: string | undefined) {
  const parsed = new URL(raw ?? '');
  return { path: `${parsed.origin}${parsed.pathname}`, query: Object.fromEntries(parsed.searchParams) };
}

describe('HttpMarketDataGateway', () => {
  describe('searchInstruments', () => {
    it('sends an encoded query with feed details and maps valid hits', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          assets: [
            {
              id: ID,
              symbol: 'COMI',
              name: 'CIB',
              asset_class: 'STOCK',
              currency: 1,
              feed: { market_id: 'NOPL' },
            },
            { id: OTHER, symbol: 'USD/EGP' },
            { symbol: 'NOID' },
          ],
        }),
      );
      const out = await gateway.searchInstruments('Commercial & Intl', 'egypt');
      expect(fetch.calls).toHaveLength(1);
      const call = fetch.calls[0]!;
      expect(call.method).toBe('GET');
      expect(call.url).toBe(
        `${API}/assets-service/assets/search?query=Commercial+%26+Intl&market=egypt&include_feed=true&feed_detail=true`,
      );
      expect(call.headers).toMatchObject({ authorization: 'Bearer TOKEN', 'x-correlation-id': 'cid' });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        name: 'CIB',
        market: 'egypt',
        currency: 'EGP',
        board: 'NOPL',
        assetClass: 'STOCK',
      });
      expect(out[0]!.ticker.value).toBe('COMI');
    });

    it('uses the requested market as fallback and tolerates a missing list', async () => {
      const { gateway } = setup(
        () => json({ assets: [{ id: ID, symbol: 'AAPL' }] }),
        () => json({}),
      );
      expect((await gateway.searchInstruments('AAPL', 'us'))[0]!.market).toBe('us');
      expect(await gateway.searchInstruments('x', 'us')).toEqual([]);
    });
  });

  describe('getInstrument', () => {
    it('loads details with feed params and the language header', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          id: ID,
          symbol: 'COMI',
          name: 'CIB',
          is_3dp: true,
          about: 'Bank',
          stats: { symbol_state: 'S' },
        }),
      );
      const out = await gateway.getInstrument(AssetId.of(ID));
      expect(fetch.calls[0]!.url).toBe(
        `${API}/assets-service/assets/${ID}?include_feed=true&feed_detail=true`,
      );
      expect(fetch.calls[0]!.headers['x-language']).toBe('en');
      expect(out).toMatchObject({
        name: 'CIB',
        priceDecimals: 3,
        description: 'Bank',
        suspended: true,
        market: 'egypt',
      });
    });

    it('falls back to the requested id and sanitises odd symbols', async () => {
      const { gateway } = setup(() => json({ symbol: 'USD/EGP', market: 'egypt' }));
      const out = await gateway.getInstrument(AssetId.of(OTHER));
      expect(out.id.value).toBe(OTHER);
      expect(out.ticker.value).toBe('USD-EGP');
    });

    it('throws an UpstreamError on unusable payloads', async () => {
      const { gateway } = setup(
        () => json({ id: ID }),
        () => new Response(null, { status: 200 }),
      );
      await expect(gateway.getInstrument(AssetId.of(ID))).rejects.toThrow(UpstreamError);
      await expect(gateway.getInstrument(AssetId.of(ID))).rejects.toThrow(
        `Unexpected asset payload from Thndr for ${ID}`,
      );
    });
  });

  describe('getMarketQuotes', () => {
    it('maps marketwatch rows and skips invalid ones', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          assets: [
            {
              asset_id: ID,
              reuters: 'COMI',
              eng_name: 'CIB',
              eng_desc: 'Banks',
              currency: 1,
              last_trade_price: 80,
              listed_shares: 10,
              symbol_state: 'S',
            },
            { asset_id: OTHER, reuters: 'BAD SYMBOL' },
            { reuters: 'NOID' },
          ],
        }),
      );
      const out = await gateway.getMarketQuotes('egypt');
      expect(fetch.calls[0]!.url).toBe(`${API}/assets-service/assets/marketwatch?market=egypt`);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        name: 'CIB',
        sector: 'Banks',
        currency: 'EGP',
        marketCap: 800,
        suspended: true,
      });
    });

    it('returns an empty list when assets are missing', async () => {
      const { gateway } = setup(() => json({ assets: null }));
      expect(await gateway.getMarketQuotes('us')).toEqual([]);
    });
  });

  describe('getCandles', () => {
    it('calls krakend with the lower-cased id, API resolution and unix seconds', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          trades_candles: [
            {
              timestamp: '2026-01-15T10:00:00Z',
              open: '10',
              high: '11',
              low: '9.5',
              close: '10.5',
              volume: '100',
            },
            { timestamp: '2026-01-15T11:00:00Z', open: 'x', high: 1, low: 1, close: 1, volume: 1 },
          ],
        }),
      );
      const out = await gateway.getCandles(
        AssetId.of(ID.toUpperCase()),
        '1h',
        new Date('2026-01-15T00:00:00.900Z'),
        new Date('2026-01-15T12:00:00Z'),
      );
      expect(url(fetch.calls[0]!.url)).toEqual({
        path: `${KRAKEND}/feed/advanced-charts/v2/${ID}/trades`,
        query: { resolution: '1HR', start_timestamp: '1768435200', end_timestamp: '1768478400' },
      });
      expect(fetch.calls[0]!.headers.authorization).toBe('Bearer TOKEN');
      expect(out).toEqual([
        { time: new Date('2026-01-15T10:00:00Z'), open: 10, high: 11, low: 9.5, close: 10.5, volume: 100 },
      ]);
    });

    it.each([
      ['1min', '1MIN'],
      ['5min', '5MIN'],
      ['10min', '10MIN'],
      ['1d', '1D'],
      ['1w', '1W'],
    ] as const)('maps resolution %s to %s', async (resolution, wire) => {
      const { fetch, gateway } = setup(() => json({}));
      expect(await gateway.getCandles(AssetId.of(ID), resolution, new Date(0), new Date(1000))).toEqual([]);
      expect(url(fetch.calls[0]!.url).query.resolution).toBe(wire);
    });

    it('surfaces krakend backend errors returned with HTTP 200', async () => {
      const { gateway } = setup(() =>
        json({
          'error_error_feed-historicals-service': {
            http_status_code: 429,
            http_body: '{"detail":{"msg":"Too many requests","type":"RATE_LIMITED"}}',
          },
        }),
      );
      const error = await gateway
        .getCandles(AssetId.of(ID), '1d', new Date(0), new Date(1000))
        .catch((e) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ status: 429, upstreamCode: 'RATE_LIMITED' });
      expect(error.message).toContain(`GET /feed/advanced-charts/v2/${ID}/trades`);
      expect(error.message).toContain('Too many requests');
    });
  });

  describe('getOrderBook', () => {
    it('maps depth levels sorted best first', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          bids_per_price: [
            { order_price: 9.8, volume_traded: 10, split: 1 },
            { order_price: 9.9, volume_traded: 20, split: 2 },
          ],
          asks_per_price: [
            { order_price: 10.2, volume_traded: 5 },
            { order_price: 10.1, volume_traded: 15, split: 3 },
          ],
          total_bids_and_asks: { total_bids: 30, total_asks: 20 },
        }),
      );
      const book = await gateway.getOrderBook(AssetId.of(ID));
      expect(fetch.calls[0]!.url).toBe(`${API}/assets-service/market-depth/${ID}`);
      expect(book.bids.map((l) => l.price)).toEqual([9.9, 9.8]);
      expect(book.asks.map((l) => l.price)).toEqual([10.1, 10.2]);
      expect(book).toMatchObject({ totalBidQuantity: 30, totalAskQuantity: 20 });
    });
  });

  describe('getRecentTrades', () => {
    it('requests the v3 trades book with page size and cursor', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          trades: [
            { cursor: 42, price: 10, volume: 5, side: 'BUY', time: '2026-01-15T10:00:00Z' },
            { price: 10, volume: 5 },
          ],
        }),
      );
      const out = await gateway.getRecentTrades(AssetId.of(ID), 25, '100');
      expect(fetch.calls[0]!.url).toBe(
        `${API}/assets-service/market-depth/v3/trades-book/${ID}?page_size=25&before=100`,
      );
      expect(out).toEqual([
        { price: 10, quantity: 5, side: 'BUY', time: new Date('2026-01-15T10:00:00Z'), cursor: '42' },
      ]);
    });

    it('omits the cursor when absent', async () => {
      const { fetch, gateway } = setup(() => json({}));
      expect(await gateway.getRecentTrades(AssetId.of(ID), 50)).toEqual([]);
      expect(fetch.calls[0]!.url).toBe(
        `${API}/assets-service/market-depth/v3/trades-book/${ID}?page_size=50`,
      );
    });
  });

  describe('getMarketSession', () => {
    const byPath: Responder = (req) =>
      req.url.includes('/status')
        ? json({ is_active: true })
        : json({ session_open: '2026-01-15T08:00:00Z', session_close: '2026-01-15T12:30:00Z' });

    it('combines status (with the board) and hours', async () => {
      const { fetch, gateway } = setup(byPath);
      const session = await gateway.getMarketSession('egypt', 'NOPL');
      expect(fetch.calls.map((c) => c.url).sort()).toEqual([
        `${API}/market-service/markets/hours?market=egypt`,
        `${API}/market-service/markets/status?market=egypt&market_exchange=NOPL`,
      ]);
      expect(session).toEqual({
        market: 'egypt',
        isOpen: true,
        opensAt: new Date('2026-01-15T08:00:00Z'),
        closesAt: new Date('2026-01-15T12:30:00Z'),
      });
    });

    it('omits the board when not given and tolerates an hours failure', async () => {
      const { fetch, gateway } = setup((req) =>
        req.url.includes('/status') ? json({ is_active: false }) : json({ detail: { msg: 'x' } }, 500),
      );
      const session = await gateway.getMarketSession('us', null);
      expect(fetch.calls.map((c) => c.url)).toContain(`${API}/market-service/markets/status?market=us`);
      expect(session).toEqual({ market: 'us', isOpen: false, opensAt: null, closesAt: null });
    });

    it('treats a non-boolean is_active as closed and propagates status failures', async () => {
      const { gateway } = setup((req) => (req.url.includes('/status') ? json({}) : json({})));
      expect((await gateway.getMarketSession('egypt')).isOpen).toBe(false);
      const failing = setup((req) => (req.url.includes('/status') ? json({}, 503) : byPath(req)));
      await expect(failing.gateway.getMarketSession('egypt')).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('getMarketIndicators', () => {
    it('requests 100 indicators with feed details and maps them to quotes', async () => {
      const { fetch, gateway } = setup(() =>
        json({
          results: [
            {
              id: ID,
              symbol: 'EGX30',
              name: 'EGX 30',
              feed: { last_trade_price: 30000, price: 1, last_change_prc: 1.2, previous_close: 29640 },
            },
            { id: OTHER, symbol: 'USD/EGP', feed: { last_trade_price: 0, price: 50.5 } },
            { symbol: 'NOID' },
          ],
        }),
      );
      const out = await gateway.getMarketIndicators('egypt');
      expect(fetch.calls[0]!.url).toBe(
        `${API}/assets-service/assets/market-indicators?market=egypt&page_count=100&include_feed=true&feed_detail=true`,
      );
      expect(out.map((q) => [q.ticker.value, q.last, q.changePercent, q.previousClose])).toEqual([
        ['EGX30', 30000, 1.2, 29640],
        ['USD-EGP', 50.5, null, null],
      ]);
    });

    it('returns an empty list when results are missing', async () => {
      const { gateway } = setup(() => json({}));
      expect(await gateway.getMarketIndicators('us')).toEqual([]);
    });
  });
});
