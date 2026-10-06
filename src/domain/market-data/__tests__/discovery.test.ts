import { describe, expect, it } from 'vitest';
import { findTag, type Tag } from '../discovery';

const tag = (id: string, name: string, slug: string | null = null): Tag => ({
  id,
  name,
  slug,
  about: null,
  instrumentCount: null,
  featured: false,
});

const TAGS = [
  tag('179', 'Gold Funds', 'gold'),
  tag('157', 'Sharia', 'sharia'),
  tag('153', 'Dividend Players', 'Dividends'),
  tag('12', 'Real Estate Funds'),
  tag('13', 'Equity Funds'),
];

describe('findTag', () => {
  it('matches the id, the slug or the name, ignoring case, spacing and dashes', () => {
    expect(findTag(TAGS, '157')?.name).toBe('Sharia');
    expect(findTag(TAGS, ' GOLD ')?.id).toBe('179');
    expect(findTag(TAGS, 'dividends')?.id).toBe('153');
    expect(findTag(TAGS, 'gold-funds')?.id).toBe('179');
    expect(findTag(TAGS, 'dividend_players')?.id).toBe('153');
  });

  it('accepts a unique partial name and rejects an ambiguous or unknown one', () => {
    expect(findTag(TAGS, 'real estate')?.id).toBe('12');
    expect(findTag(TAGS, 'funds')).toBeNull();
    expect(findTag(TAGS, 'crypto')).toBeNull();
    expect(findTag(TAGS, '   ')).toBeNull();
  });
});
