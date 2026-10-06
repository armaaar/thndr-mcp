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
    for (const input of [{ page: 0 }, { locale: 'fr' }, { contentChars: -1 }, { symbol: '' }]) {
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
        aNewsArticle({ id: 'fits', content: 'abcde' }),
        aNewsArticle({ id: 'over', content: 'abcdef' }),
        aNewsArticle({ id: 'space', content: 'abcd efg' }),
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
});
