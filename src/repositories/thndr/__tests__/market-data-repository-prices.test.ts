import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type Responder } from '../../../__tests__/support/fake-fetch';
import { idFor } from '../../../__tests__/support/fake-market-data';
import { UpstreamError } from '../../../application/errors';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ThndrMarketDataRepository } from '../market-data-repository';

const API = 'https://prod.thndr.app';
const KRAKEND = 'https://prod.thndr.app/krakend-thndr-x';
const GATEWAY = 'https://prod.thndr.app/krakend-thndr-app';
const US = idFor('NVDA');
const AE = idFor('FAB');

const tokens = { getAccessToken: async () => 'TOKEN', invalidate: () => {} };

function setup(...responders: Responder[]) {
  const fetch = fakeFetch(...responders);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, tokenProvider: tokens, runtimeVersion: '3.8.3' });
  return { fetch, repo: new ThndrMarketDataRepository(client(API), client(KRAKEND), client(GATEWAY)) };
}

describe('ThndrMarketDataRepository — prices outside the marketwatch', () => {
  describe('getLatestPrices', () => {
    it('asks the mobile gateway for sorted, unique, repeated asset ids with the bearer token', async () => {
      const { fetch, repo } = setup(() =>
        json({
          price: { results: [{ asset_id: US, price: { last: { value: 240.1, price_field: 'close' } } }] },
          day_snapshot: { results: [{ asset_id: US, day_snapshot: { last: { previous_close: 238.9 } } }] },
        }),
      );
      const out = await repo.getLatestPrices([AssetId.of(US), AssetId.of(AE), AssetId.of(US)]);
      const [first, second] = [US, AE].sort();
      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]?.url).toBe(`${GATEWAY}/securities/v2/price?asset_id=${first}&asset_id=${second}`);
      expect(fetch.calls[0]?.headers.authorization).toBe('Bearer TOKEN');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ last: 240.1, previousClose: 238.9, kind: 'close' });
    });

    it('makes no call without ids, and batches by 50', async () => {
      const { fetch, repo } = setup(() => json({}));
      expect(await repo.getLatestPrices([])).toEqual([]);
      expect(fetch.calls).toHaveLength(0);
      const ids = Array.from({ length: 51 }, (_, i) => AssetId.of(idFor(`T${i}`)));
      await repo.getLatestPrices(ids);
      expect(fetch.calls).toHaveLength(2);
      expect(new URL(fetch.calls[0]?.url ?? '').searchParams.getAll('asset_id')).toHaveLength(50);
      expect(new URL(fetch.calls[1]?.url ?? '').searchParams.getAll('asset_id')).toHaveLength(1);
    });

    it('surfaces a KrakenD section error from a 200 body', async () => {
      const { repo } = setup(() =>
        json({
          error_asset_price_v2: {
            http_status_code: 403,
            http_body: JSON.stringify({ detail: { msg: 'Feature disabled', type: 'FEATURE_DISABLED' } }),
          },
        }),
      );
      const error = await repo.getLatestPrices([AssetId.of(US)]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ status: 403, message: expect.stringContaining('error_asset_price_v2') });
    });
  });

  describe('getCloses', () => {
    it('reads the charts of one asset with the instrument market (adsm for the UAE)', async () => {
      const { fetch, repo } = setup(() =>
        json({ [AE]: { '2025-10-14T00:00:00Z': 16.18, '2025-10-13T00:00:00Z': 16.14 } }),
      );
      const out = await repo.getCloses(AssetId.of(AE), 'uae', '1y');
      expect(fetch.calls[0]?.url).toBe(`${API}/assets-service/charts?asset_ids=${AE}&option=1y&market=adsm`);
      expect(out.map((p) => p.close)).toEqual([16.14, 16.18]);
    });

    it('sends the US market and the full-history option', async () => {
      const { fetch, repo } = setup(() => json({}));
      expect(await repo.getCloses(AssetId.of(US), 'us', 'all')).toEqual([]);
      expect(fetch.calls[0]?.url).toBe(`${API}/assets-service/charts?asset_ids=${US}&option=all&market=us`);
    });
  });
});
