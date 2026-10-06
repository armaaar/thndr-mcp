import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type Responder } from '../../../__tests__/support/fake-fetch';
import { NotFoundError, UpstreamError } from '../../../application/errors';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { AssetId } from '../../../domain/shared-kernel/asset-id';
import { Ticker } from '../../../domain/shared-kernel/ticker';
import { ThndrResearchRepository } from '../research-repository';

const ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const API = 'https://prod.thndr.app';
const WEB = 'https://x.thndr.app/api';

const tokens = { getAccessToken: async () => 'TOKEN', invalidate: () => {} };

function setup(...responders: Responder[]) {
  const fetch = fakeFetch(...responders);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, tokenProvider: tokens, runtimeVersion: '3.8.3' });
  return { fetch, repo: new ThndrResearchRepository(client(API), client(WEB)) };
}

const notFound = () => json({ error: 'Symbol not found' }, 404);

describe('ThndrResearchRepository', () => {
  describe('getFinancials', () => {
    it('asks x.thndr.app for one symbol with the bearer token and maps the series', async () => {
      const { fetch, repo } = setup(() =>
        json({ currency: 'EGP', revenues: [{ period: 'TTM Q2 26', value: 131 }] }),
      );
      const out = await repo.getFinancials(Ticker.of('COMI'), 'ttm', 4);
      expect(fetch.calls[0]?.url).toBe(`${WEB}/financials?symbol=COMI&mode=ttm&dataPointCount=4`);
      expect(fetch.calls[0]?.headers.authorization).toBe('Bearer TOKEN');
      expect(out.series.revenues).toEqual([{ period: 'TTM Q2 26', value: 131 }]);
    });

    it('omits dataPointCount when not given', async () => {
      const { fetch, repo } = setup(() => json({ revenues: [{ period: '2025', value: 1 }] }));
      await repo.getFinancials(Ticker.of('COMI'), 'yoy');
      expect(fetch.calls[0]?.url).toBe(`${WEB}/financials?symbol=COMI&mode=yoy`);
    });

    it('turns "Symbol not found" and an empty answer into NOT_FOUND', async () => {
      await expect(setup(notFound).repo.getFinancials(Ticker.of('NOPE'), 'ttm')).rejects.toThrow(
        new NotFoundError('Thndr has no financials for NOPE.'),
      );
      await expect(
        setup(() => json({ currency: 'EGP' })).repo.getFinancials(Ticker.of('ETF'), 'ttm'),
      ).rejects.toThrow(NotFoundError);
    });

    it('lets other upstream errors through', async () => {
      const { repo } = setup(() => json({ detail: 'boom' }, 500));
      await expect(repo.getFinancials(Ticker.of('COMI'), 'ttm')).rejects.toThrow(UpstreamError);
    });
  });

  describe('getFinancialsBatch', () => {
    it('asks for every symbol in one call and keys the result by symbol', async () => {
      const { fetch, repo } = setup(() =>
        json({ COMI: { revenues: [{ period: 'Q2 26', value: 5 }] }, ADIB: { revenues: [] } }),
      );
      const out = await repo.getFinancialsBatch([Ticker.of('COMI'), Ticker.of('ADIB')], 'qoq');
      expect(fetch.calls[0]?.url).toBe(`${WEB}/financials?symbols=COMI%2CADIB&mode=qoq`);
      expect([...out.keys()]).toEqual(['COMI', 'ADIB']);
    });

    it('makes no call for no symbols and treats a 404 as no data', async () => {
      const empty = setup(notFound);
      expect((await empty.repo.getFinancialsBatch([], 'ttm')).size).toBe(0);
      expect(empty.fetch.calls).toHaveLength(0);
      expect((await empty.repo.getFinancialsBatch([Ticker.of('NOPE')], 'ttm')).size).toBe(0);
    });

    it('lets other upstream errors through', async () => {
      const { repo } = setup(() => json({}, 502));
      await expect(repo.getFinancialsBatch([Ticker.of('COMI')], 'ttm')).rejects.toThrow(UpstreamError);
    });
  });

  describe('getNews', () => {
    it('reads one page for an instrument from prod', async () => {
      const { fetch, repo } = setup(() =>
        json({
          count: 202,
          next: 'https://prod.thndr.app/api/post/news/?page=3',
          results: [{ id: 1, title: 'T' }],
        }),
      );
      const page = await repo.getNews({ assetId: AssetId.of(ID), locale: 'ar', page: 2 });
      expect(fetch.calls[0]?.url).toBe(`${API}/api/post/news/?asset_id=${ID}&locale=ar&page=2`);
      expect(page).toMatchObject({ total: 202, hasMore: true, articles: [{ id: '1', title: 'T' }] });
    });

    it('reads market-wide news without an asset id', async () => {
      const { fetch, repo } = setup(() => json({ count: 0, next: null, results: [] }));
      await repo.getNews({ locale: 'en', page: 1 });
      expect(fetch.calls[0]?.url).toBe(`${API}/api/post/news/?locale=en&page=1`);
    });

    it('answers an empty page past the last one, but not a 404 on the first page', async () => {
      const invalid = () => json({ detail: 'Invalid page.' }, 404);
      expect(await setup(invalid).repo.getNews({ locale: 'en', page: 99 })).toEqual({
        total: null,
        hasMore: false,
        articles: [],
      });
      await expect(setup(invalid).repo.getNews({ locale: 'en', page: 1 })).rejects.toThrow(UpstreamError);
    });
  });

  it('reads the macros from x.thndr.app', async () => {
    const { fetch, repo } = setup(() =>
      json({ metadata: { description: 'Egypt Macroeconomic Data' }, overview: {}, inflation_yearly: [] }),
    );
    const out = await repo.getEconomicIndicators();
    expect(fetch.calls[0]?.url).toBe(`${WEB}/macros`);
    expect(out.description).toBe('Egypt Macroeconomic Data');
  });

  it('reads Thndr’s yearly return from the asset details', async () => {
    const { fetch, repo } = setup(() => json({ id: ID, annual_return: { value: 30.01, return: 'gain' } }));
    expect(await repo.getYearlyReturn(AssetId.of(ID))).toEqual({ percent: 30.01, direction: 'gain' });
    expect(fetch.calls[0]?.url).toBe(`${API}/assets-service/assets/${ID}?include_yearly_return=true`);
  });
});
