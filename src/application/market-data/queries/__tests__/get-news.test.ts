import { describe, expect, it } from 'vitest';
import { COMI_ID, setupMarketData, withInstruments } from '../../../../__tests__/support/fake-market-data';
import { aNewsArticle, FakeResearchRepository } from '../../../../__tests__/support/fake-research';
import { GetNews } from '../get-news';

function setup() {
  const research = new FakeResearchRepository();
  research.news = {
    total: 202,
    hasMore: true,
    articles: [
      aNewsArticle({ id: '1', content: 'x'.repeat(600) }),
      aNewsArticle({ id: '2', content: '', publishedAt: null, tickers: [] }),
    ],
  };
  return setupMarketData(withInstruments('COMI'), undefined, research);
}

describe('GetNews', () => {
  it('declares its contract', async () => {
    const uc = new GetNews(setup());
    expect(uc).toMatchObject({ name: 'get_news', kind: 'query', context: 'market-data' });
    for (const input of [
      { page: 0 },
      { locale: 'fr' },
      { contentChars: -1 },
      { symbol: '' },
      { limit: 0 },
      { limit: 26 },
    ]) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('reads an instrument’s news and truncates long content', async () => {
    const deps = setup();
    const out = await new GetNews(deps).run({ symbol: 'COMI', page: 2, locale: 'ar' });
    expect(deps.research.calls.getNews).toEqual([
      { assetId: expect.objectContaining({ value: COMI_ID }), locale: 'ar', page: 2 },
    ]);
    expect(out).toMatchObject({ ticker: 'COMI', locale: 'ar', page: 2, total: 202, hasMore: true });
    expect(out.items[0]).toEqual({
      id: '1',
      title: 'Release from COMI',
      content: `${'x'.repeat(500)}…`,
      contentTruncated: true,
      source: 'egx',
      link: 'https://egx.com.eg/downloads/Bulletins/1.pdf',
      publishedAt: '2026-07-21T08:16:53.000Z',
      market: 'egypt',
      tickers: ['COMI'],
    });
    expect(out.items[1]).toMatchObject({ id: '2', content: '', publishedAt: null, tickers: [] });
    expect(out.items[1]).not.toHaveProperty('contentTruncated');
  });

  it('truncates only content longer than contentChars', async () => {
    const deps = setup();
    deps.research.news = {
      total: 2,
      hasMore: false,
      articles: [
        aNewsArticle({ id: 'fits', title: 'A', content: 'abcde' }),
        aNewsArticle({ id: 'over', title: 'B', content: 'abcdef' }),
        aNewsArticle({ id: 'space', title: 'C', content: 'abcd efg' }),
      ],
    };
    const out = await new GetNews(deps).run({ contentChars: 5 });
    expect(out.items[0]).toMatchObject({ content: 'abcde' });
    expect(out.items[0]).not.toHaveProperty('contentTruncated');
    expect(out.items[1]).toMatchObject({ content: 'abcde…', contentTruncated: true });
    expect(out.items[2]).toMatchObject({ content: 'abcd…', contentTruncated: true });
  });

  it('reads market-wide news with defaults, and can omit or lengthen the content', async () => {
    const deps = setup();
    const out = await new GetNews(deps).run({ contentChars: 0 });
    expect(deps.research.calls.getNews[0]).toEqual({ assetId: undefined, locale: 'en', page: 1 });
    expect(out.ticker).toBeNull();
    expect(out.items[0]).not.toHaveProperty('content');
    const direct = await new GetNews(deps).execute({});
    expect(direct).toMatchObject({ locale: 'en', page: 1 });
    expect(direct.items[0]?.content).toHaveLength(501);
    const full = await new GetNews(deps).run({ contentChars: 1000 });
    expect(full.items[0]?.content).toHaveLength(600);
  });

  it('drops repeated filings and keeps the first `limit` articles', async () => {
    const deps = setup();
    const at = new Date('2026-08-02T08:36:29Z');
    deps.research.news = {
      total: 168,
      hasMore: false,
      articles: [
        aNewsArticle({ id: 'a1', title: 'Board decisions', publishedAt: new Date('2026-08-13T12:29:41Z') }),
        aNewsArticle({ id: 'r-nolink', title: 'ADIB Reports 6 Months Results', link: null, publishedAt: at }),
        aNewsArticle({ id: 'r-link', title: 'ADIB  reports 6 months results', publishedAt: at }),
        aNewsArticle({ id: 'a3', title: 'Disclosure form', publishedAt: new Date('2026-07-13T12:20:28Z') }),
      ],
    };
    const all = await new GetNews(deps).run({ symbol: 'COMI' });
    expect(all.items.map((i) => i.id)).toEqual(['a1', 'r-link', 'a3']);
    expect(all).toMatchObject({ duplicatesRemoved: 1, hasMore: false, total: 168 });

    const two = await new GetNews(deps).run({ symbol: 'COMI', limit: 2 });
    expect(two.items.map((i) => i.id)).toEqual(['a1', 'r-link']);
    // More articles remain on this page, so there is more to read even on Thndr's last page.
    expect(two.hasMore).toBe(true);
    expect((await new GetNews(deps).run({ limit: 3 })).hasMore).toBe(false);
    expect((await new GetNews(deps).execute({ limit: 0 })).items).toHaveLength(1);
  });

  it('returns the whole page by default and never more than 25', async () => {
    const deps = setup();
    deps.research.news = {
      total: 30,
      hasMore: false,
      articles: Array.from({ length: 30 }, (_, i) => aNewsArticle({ id: `n${i}`, title: `News ${i}` })),
    };
    const out = await new GetNews(deps).run({});
    expect(out.items).toHaveLength(25);
    expect(out.hasMore).toBe(true);
    deps.research.news = { ...deps.research.news, articles: deps.research.news.articles.slice(0, 12) };
    const page = await new GetNews(deps).run({});
    expect(page.items).toHaveLength(12);
    expect(page.hasMore).toBe(false);
    expect((await new GetNews(deps).execute({ limit: 100 })).items).toHaveLength(12);
    deps.research.news = {
      ...deps.research.news,
      articles: Array.from({ length: 30 }, (_, i) => aNewsArticle({ id: `m${i}`, title: `M ${i}` })),
    };
    expect((await new GetNews(deps).execute({ limit: 100 })).items).toHaveLength(25);
  });

  it('serves US market news for market "us" without a symbol', async () => {
    const deps = setup();
    const out = await new GetNews(deps).run({ market: 'us' });
    expect(deps.research.calls.getNews).toEqual([
      { assetId: undefined, market: 'us', locale: 'en', page: 1 },
    ]);
    expect(out.market).toBe('us');
  });

  it('keeps the mixed feed for other markets without a symbol, and per-instrument news with one', async () => {
    const deps = setup();
    const mixed = await new GetNews(deps).run({ market: 'uae' });
    expect(deps.research.calls.getNews[0]).not.toHaveProperty('market');
    expect(mixed.market).toBeNull();
    await new GetNews(deps).run({ symbol: 'COMI' });
    expect(deps.research.calls.getNews[1]).not.toHaveProperty('market');
  });

  it('reports no locale for the US market feed, which takes none', async () => {
    const out = await new GetNews(setup()).run({ market: 'us', locale: 'ar' });
    expect(out.locale).toBeNull();
  });
});
