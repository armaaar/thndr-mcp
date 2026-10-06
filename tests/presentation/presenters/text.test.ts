import { describe, expect, it } from 'vitest';
import { renderTable, renderText } from '../../../src/presentation/presenters/text';

describe('renderText', () => {
  it('renders scalars, with null as a dash', () => {
    expect(renderText('hello')).toBe('hello');
    expect(renderText(42)).toBe('42');
    expect(renderText(false)).toBe('false');
    expect(renderText(null)).toBe('-');
    expect(renderText(null, '  ')).toBe('  -');
  });

  it('renders empty arrays as (none) and arrays of scalars as a bullet list', () => {
    expect(renderText([])).toBe('(none)');
    expect(renderText(['COMI', 3, null, [1, 2]])).toBe('- COMI\n- 3\n- -\n- [1,2]');
  });

  it('renders arrays of records as an aligned table with the union of columns', () => {
    const out = renderText([
      { ticker: 'COMI', price: 80.5 },
      { ticker: 'HRHO', change: -1, tags: ['a'], meta: { x: 1 } },
    ]);
    expect(out.split('\n')).toEqual([
      'ticker  price  change  tags   meta',
      '------  -----  ------  -----  -------',
      'COMI    80.5   -       -      -',
      'HRHO    -      -1      ["a"]  {"x":1}',
    ]);
  });

  it('indents nested records and renders key: value lines', () => {
    expect(
      renderText({
        authenticated: true,
        expiresAt: null,
        session: { user: 'me', flags: { beta: false } },
      }),
    ).toBe(
      ['authenticated: true', 'expiresAt: -', 'session:', '  user: me', '  flags:', '    beta: false'].join(
        '\n',
      ),
    );
  });

  it('renders records containing tables, scalar lists and empty arrays', () => {
    expect(
      renderText({
        market: 'egypt',
        missing: [],
        tickers: ['COMI', 'HRHO'],
        quotes: [
          { ticker: 'COMI', last: 80 },
          { ticker: 'HRHO', last: 21.25 },
        ],
      }),
    ).toBe(
      [
        'market: egypt',
        'missing: (none)',
        'tickers:',
        '  - COMI',
        '  - HRHO',
        'quotes:',
        '  ticker  last',
        '  ------  -----',
        '  COMI    80',
        '  HRHO    21.25',
      ].join('\n'),
    );
  });

  it('renders an empty record as an empty string', () => {
    expect(renderText({})).toBe('');
  });
});

describe('renderTable', () => {
  it('pads columns to the widest cell and trims trailing spaces', () => {
    expect(renderTable([{ a: 'long value', b: 1 }, { a: 'x' }])).toBe(
      ['a           b', '----------  -', 'long value  1', 'x           -'].join('\n'),
    );
  });
});
