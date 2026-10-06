import { describe, expect, it } from 'vitest';
import { aNewsArticle } from '../../../__tests__/support/fake-research';
import { dedupeNews } from '../research';

const at = new Date('2026-08-02T08:36:29Z');

describe('dedupeNews', () => {
  it('keeps one article per title and time, preferring the copy with a link', () => {
    const out = dedupeNews([
      aNewsArticle({ id: 'nolink', title: 'Reports 6 Months Results', link: null, publishedAt: at }),
      aNewsArticle({ id: 'other', title: 'Board decisions', publishedAt: at }),
      aNewsArticle({ id: 'link', title: ' reports 6  months results ', publishedAt: at }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['link', 'other']);
  });

  it('keeps a linked copy over a later unlinked one, and the longer content between equals', () => {
    expect(
      dedupeNews([
        aNewsArticle({ id: 'link', publishedAt: at }),
        aNewsArticle({ id: 'nolink', link: null, content: 'x'.repeat(500), publishedAt: at }),
      ]).map((a) => a.id),
    ).toEqual(['link']);
    expect(
      dedupeNews([
        aNewsArticle({ id: 'short', content: 'a', publishedAt: at }),
        aNewsArticle({ id: 'long', content: 'abc', publishedAt: at }),
        aNewsArticle({ id: 'same', content: 'abc', publishedAt: at }),
      ]).map((a) => a.id),
    ).toEqual(['long']);
    expect(
      dedupeNews([
        aNewsArticle({ id: 'nolink-long', link: null, content: 'abcdef', publishedAt: at }),
        aNewsArticle({ id: 'link-short', content: '', publishedAt: at }),
      ]).map((a) => a.id),
    ).toEqual(['link-short']);
  });

  it('never merges articles with different times or tickers, or without a time or a title', () => {
    const out = dedupeNews([
      aNewsArticle({ id: 'a', publishedAt: at }),
      aNewsArticle({ id: 'b', publishedAt: new Date(at.getTime() + 1) }),
      aNewsArticle({ id: 'other-ticker', publishedAt: at, tickers: ['HRHO'] }),
      aNewsArticle({ id: 'same-tickers', publishedAt: at, tickers: ['COMI'] }),
      aNewsArticle({ id: 'c', publishedAt: null }),
      aNewsArticle({ id: 'd', publishedAt: null, link: null }),
      aNewsArticle({ id: 'e', title: ' ', publishedAt: at }),
      aNewsArticle({ id: 'f', title: '', publishedAt: at }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['a', 'b', 'other-ticker', 'c', 'd', 'e', 'f']);
    expect(
      dedupeNews([
        aNewsArticle({ id: 'x', publishedAt: at, tickers: ['B', 'A'] }),
        aNewsArticle({ id: 'y', publishedAt: at, tickers: ['A', 'B'] }),
      ]).map((a) => a.id),
    ).toEqual(['x']);
    expect(dedupeNews([])).toEqual([]);
  });
});
