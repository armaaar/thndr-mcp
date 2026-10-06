import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type Responder } from '../../../../__tests__/support/fake-fetch';
import { UpstreamError } from '../../../../application/errors';
import { WatchlistName } from '../../../../domain/engagement/watchlist';
import { AssetId } from '../../../../domain/market-data/asset-id';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { ThndrEngagementRepository } from '../engagement-repository';

const A = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const B = 'b0a4c53e-b12f-4e93-b94b-759b8eeaef14';
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
  return { fetch, gateway: new ThndrEngagementRepository(client(API), client(KRAKEND)) };
}

const empty = () => new Response('', { status: 200 });
const krakendError = (key: string, status = 500) =>
  json({ [key]: { http_status_code: status, http_body: '{"detail":{"msg":"boom","type":"X"}}' } });

describe('ThndrEngagementRepository — watchlists', () => {
  it('lists watchlists of a market and skips malformed rows', async () => {
    const { fetch, gateway } = setup(() =>
      json({
        watchlists: [
          { id: 'w1', name: 'Banks', color: 'color_4', icon: 'thndr', count: 2, asset_ids: [A, 'junk', B] },
          { name: 'no id' },
        ],
      }),
    );
    const out = await gateway.listWatchlists('egypt');
    expect(fetch.calls[0]).toMatchObject({
      method: 'GET',
      url: `${API}/users-service/watchlists?market=egypt`,
    });
    expect(fetch.calls[0]!.headers).toMatchObject({ authorization: 'Bearer TOKEN' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'w1', name: 'Banks', color: 'color_4', icon: 'thndr' });
    expect(out[0]!.instrumentIds.map((i) => i.value)).toEqual([A, B]);
  });

  it('tolerates a missing list', async () => {
    const { gateway } = setup(() => json({}));
    expect(await gateway.listWatchlists('us')).toEqual([]);
  });

  it('gets one watchlist, falling back to the requested id', async () => {
    const { fetch, gateway } = setup(
      () => json({ asset_ids: [B] }),
      () => json({ id: 'other', name: 'N', asset_ids: [] }),
    );
    const w = await gateway.getWatchlist('w 1');
    expect(fetch.calls[0]!.url).toBe(`${API}/users-service/watchlists/w%201`);
    expect(w).toMatchObject({ id: 'w 1', name: '', color: null });
    expect(w.instrumentIds.map((i) => i.value)).toEqual([B]);
    expect((await gateway.getWatchlist('w1')).id).toBe('other');
  });

  it('rejects an unusable detail payload', async () => {
    const { gateway } = setup(empty);
    await expect(gateway.getWatchlist('w1')).rejects.toThrow(
      'Unexpected watchlist payload from Thndr for w1',
    );
  });

  it('creates a watchlist with source thndrx and completes the response', async () => {
    const { fetch, gateway } = setup(
      () => json({ id: 'w9' }),
      () => json({ id: 'w10', name: 'Server', asset_ids: [B] }),
    );
    const created = await gateway.createWatchlist(WatchlistName.of('Banks'), 'egypt', [AssetId.of(A)]);
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      url: `${API}/users-service/watchlists`,
      body: { name: 'Banks', market: 'egypt', source: 'thndrx', asset_ids: [A] },
    });
    expect(created).toMatchObject({ id: 'w9', name: 'Banks' });
    expect(created.instrumentIds.map((i) => i.value)).toEqual([A]);
    const second = await gateway.createWatchlist(WatchlistName.of('X'), 'us', []);
    expect(fetch.calls[1]!.body).toEqual({ name: 'X', market: 'us', source: 'thndrx', asset_ids: [] });
    expect(second).toMatchObject({ id: 'w10', name: 'Server' });
    expect(second.instrumentIds.map((i) => i.value)).toEqual([B]);
  });

  it('fails when the created watchlist has no id', async () => {
    const { gateway } = setup(() => json({ name: 'x' }), empty);
    await expect(gateway.createWatchlist(WatchlistName.of('x'), 'egypt', [])).rejects.toThrow(
      'Thndr did not return the id of the created watchlist',
    );
    await expect(gateway.createWatchlist(WatchlistName.of('x'), 'egypt', [])).rejects.toThrow(UpstreamError);
  });

  it('renames, deletes, watches and unwatches with exact requests', async () => {
    const { fetch, gateway } = setup(empty);
    await gateway.renameWatchlist('w1', WatchlistName.of(' New '));
    await gateway.deleteWatchlist('w1');
    await gateway.addToWatchlist('w1', [AssetId.of(A), AssetId.of(B)]);
    await gateway.removeFromWatchlist('w/1', [AssetId.of(B)]);
    expect(fetch.calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'PATCH', url: `${API}/users-service/watchlists/w1`, body: { name: 'New' } },
      { method: 'DELETE', url: `${API}/users-service/watchlists/w1`, body: undefined },
      { method: 'POST', url: `${API}/users-service/watchlists/w1/watch-assets`, body: { asset_ids: [A, B] } },
      {
        method: 'POST',
        url: `${API}/users-service/watchlists/w%2F1/unwatch-assets`,
        body: { asset_ids: [B] },
      },
    ]);
  });

  it('propagates HTTP errors', async () => {
    const { gateway } = setup(() => json({ detail: { msg: 'Not found', type: 'NOT_FOUND' } }, 404));
    await expect(gateway.deleteWatchlist('w1')).rejects.toMatchObject({
      status: 404,
      upstreamCode: 'NOT_FOUND',
    });
  });
});

describe('ThndrEngagementRepository — price alerts', () => {
  const row = {
    id: 7,
    asset_id: A,
    asset_symbol: 'COMI',
    price: 110,
    frequency: 'ONE_TIME',
    direction: 'UP',
    created_at: '2026-01-01T09:00:00Z',
  };

  it('lists a page of alerts on krakend', async () => {
    const { fetch, gateway } = setup(() => json({ results: [row, { id: 8 }] }));
    const out = await gateway.listPriceAlerts('egypt', { page: 2, pageCount: 10 });
    expect(fetch.calls[0]).toMatchObject({
      method: 'GET',
      url: `${KRAKEND}/price-alerts/v1/alerts?page=2&page_count=10&market=egypt`,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: '7', targetPrice: 110, direction: 'UP', frequency: 'ONE_TIME' });
  });

  it('detects krakend errors and missing results', async () => {
    const { gateway } = setup(() => krakendError('error_price_alerts'), empty);
    await expect(gateway.listPriceAlerts('egypt', { page: 1, pageCount: 10 })).rejects.toMatchObject({
      status: 500,
      upstreamCode: 'X',
    });
    expect(await gateway.listPriceAlerts('egypt', { page: 1, pageCount: 10 })).toEqual([]);
  });

  it('lists the alerts of one asset (page 1, 5 rows)', async () => {
    const { fetch, gateway } = setup(
      () => json({ results: [row] }),
      () => krakendError('error_price_alerts'),
    );
    const out = await gateway.listAlertsForInstrument(AssetId.of(A));
    expect(fetch.calls[0]!.url).toBe(`${KRAKEND}/price-alerts/v1/asset-alerts/${A}?page=1&page_count=5`);
    expect(out.map((a) => a.id)).toEqual(['7']);
    await expect(gateway.listAlertsForInstrument(AssetId.of(A))).rejects.toThrow('error_price_alerts');
  });

  it('creates an alert with the exact body and maps the reply', async () => {
    const { fetch, gateway } = setup(
      () => json({ id: 'new', created_at: '2026-01-15T12:00:00Z' }),
      () => json({ ...row, id: 'srv', price: '111', direction: 'DOWN', frequency: 'RECURRING' }),
    );
    const input = {
      instrumentId: AssetId.of(A),
      price: 110,
      direction: 'UP',
      frequency: 'ONE_TIME',
      market: 'egypt',
    } as const;
    const created = await gateway.createPriceAlert(input);
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      url: `${KRAKEND}/price-alerts/v1/alerts`,
      body: { asset_id: A, price: 110, frequency: 'ONE_TIME', direction: 'UP', market: 'egypt' },
    });
    expect(created).toMatchObject({ id: 'new', targetPrice: 110, direction: 'UP', frequency: 'ONE_TIME' });
    expect(await gateway.createPriceAlert(input)).toMatchObject({
      id: 'srv',
      targetPrice: 111,
      direction: 'DOWN',
      frequency: 'RECURRING',
    });
  });

  it('returns null for opaque create replies and throws on krakend errors', async () => {
    const input = {
      instrumentId: AssetId.of(A),
      price: 1,
      direction: 'DOWN',
      frequency: 'RECURRING',
      market: 'us',
    } as const;
    const { gateway } = setup(
      empty,
      () => json([1]),
      () => json({ ok: true }),
      () => krakendError('error_price_alerts', 422),
    );
    expect(await gateway.createPriceAlert(input)).toBeNull();
    expect(await gateway.createPriceAlert(input)).toBeNull();
    expect(await gateway.createPriceAlert(input)).toBeNull();
    await expect(gateway.createPriceAlert(input)).rejects.toMatchObject({ status: 422 });
  });

  it('deletes an alert and treats 404 (HTTP or krakend) as success', async () => {
    const { fetch, gateway } = setup(
      empty,
      () => json({ detail: { msg: 'gone' } }, 404),
      () => krakendError('error_price_alerts', 404),
    );
    await gateway.deletePriceAlert('7');
    await gateway.deletePriceAlert('7');
    await gateway.deletePriceAlert('7');
    expect(fetch.calls.map((c) => [c.method, c.url])).toEqual(
      Array.from({ length: 3 }, () => ['DELETE', `${KRAKEND}/price-alerts/v1/alerts/7`]),
    );
  });

  it('propagates other delete errors', async () => {
    const { gateway } = setup(
      () => json({}, 500),
      () => krakendError('error_price_alerts', 500),
    );
    await expect(gateway.deletePriceAlert('7')).rejects.toMatchObject({ status: 500 });
    await expect(gateway.deletePriceAlert('7')).rejects.toThrow('error_price_alerts');
  });
});

describe('ThndrEngagementRepository — notifications', () => {
  const n = { id: 'n1', title: 'T', text: 'X', is_read: false, created_at: '2026-01-01T10:00:00Z' };

  it('lists a page (bare array or krakend collection)', async () => {
    const { fetch, gateway } = setup(
      () => json([n, { title: 'no id' }]),
      () => json({ collection: [n] }),
      () => json({}),
    );
    const out = await gateway.listNotifications(3, 20);
    expect(fetch.calls[0]).toMatchObject({
      method: 'GET',
      url: `${KRAKEND}/notifications/v1?page=3&page_count=20`,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'n1', read: false });
    expect(await gateway.listNotifications(1, 20)).toHaveLength(1);
    expect(await gateway.listNotifications(1, 20)).toEqual([]);
  });

  it('detects krakend errors on the list', async () => {
    const { gateway } = setup(() => krakendError('error_get_notifications'));
    await expect(gateway.listNotifications(1, 20)).rejects.toThrow('error_get_notifications');
  });

  it('reads the unread flag', async () => {
    const { fetch, gateway } = setup(
      () => json({ has_unread: true }),
      () => json({ has_unread: 'yes' }),
      () => krakendError('error_get_notifications_has_unread'),
    );
    expect(await gateway.hasUnreadNotifications()).toBe(true);
    expect(fetch.calls[0]).toMatchObject({ method: 'GET', url: `${KRAKEND}/notifications/v1/has-unread` });
    expect(await gateway.hasUnreadNotifications()).toBe(false);
    await expect(gateway.hasUnreadNotifications()).rejects.toThrow('error_get_notifications_has_unread');
  });

  it('marks notifications read in batch with an array body', async () => {
    const { fetch, gateway } = setup(empty, () => krakendError('error_patch_notifications_batch'));
    await gateway.markNotificationsRead(['n1', 'n2']);
    expect(fetch.calls[0]).toMatchObject({
      method: 'PATCH',
      url: `${KRAKEND}/notifications/v1/batch?field=is_read`,
      body: [{ id: 'n1' }, { id: 'n2' }],
    });
    expect(fetch.calls[0]!.headers['content-type']).toBe('application/json');
    await expect(gateway.markNotificationsRead(['n1'])).rejects.toThrow('error_patch_notifications_batch');
  });

  it('skips the request for an empty batch', async () => {
    const { fetch, gateway } = setup(empty);
    await gateway.markNotificationsRead([]);
    expect(fetch.calls).toHaveLength(0);
  });

  it('marks all notifications read without a body', async () => {
    const { fetch, gateway } = setup(empty, () => krakendError('error_patch_notifications_read_all'));
    await gateway.markAllNotificationsRead();
    expect(fetch.calls[0]).toMatchObject({
      method: 'PATCH',
      url: `${KRAKEND}/notifications/v1/read-all`,
      body: undefined,
    });
    expect(fetch.calls[0]!.headers['content-type']).toBeUndefined();
    await expect(gateway.markAllNotificationsRead()).rejects.toThrow('error_patch_notifications_read_all');
  });
});
