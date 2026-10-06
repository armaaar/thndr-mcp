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
        aNewsArticle({ id: 'nolink', link: null, publishedAt: at }),
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

  it('treats different times, or a missing time, as different articles', () => {
    const out = dedupeNews([
      aNewsArticle({ id: 'a', publishedAt: at }),
      aNewsArticle({ id: 'b', publishedAt: new Date(at.getTime() + 1) }),
      aNewsArticle({ id: 'c', publishedAt: null }),
      aNewsArticle({ id: 'd', publishedAt: null, link: null }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(dedupeNews([])).toEqual([]);
  });
});
