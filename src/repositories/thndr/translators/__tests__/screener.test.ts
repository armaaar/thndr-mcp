import { describe, expect, it } from 'vitest';
import type { ScreenerFilterDto } from '../../../../data-sources/thndr/dto/market-data';
import { SCREENER_FIELDS } from '../../../../domain/market-data/screener';
import { SCREENER_KEYS, toScreener, toScreenerFilter } from '../screener';

const range = (
  filter_key: string,
  min_value?: string | number,
  max_value?: string | number,
): ScreenerFilterDto => ({
  filter_key,
  type: 'NumberRange',
  min_value,
  max_value,
});

describe('SCREENER_KEYS', () => {
  it('maps ThndrX filter keys to known screener fields', () => {
    for (const field of Object.values(SCREENER_KEYS)) expect(SCREENER_FIELDS).toContain(field);
    expect(SCREENER_KEYS).toMatchObject({
      price: 'price',
      last_change_prc: 'changePercent',
      relative_volume: 'relativeVolume',
      high_52_week_distance: 'week52HighDistance',
      low_52_week_distance: 'week52LowDistance',
      total_value: 'value',
      eng_desc: 'sector',
      reuters: 'ticker',
      avg_5_day: 'averageVolume5d',
    });
    expect(Object.isFrozen(SCREENER_KEYS)).toBe(true);
  });
});

describe('toScreenerFilter', () => {
  it('maps number ranges like ThndrX: falsy bounds are open, "0" is a bound', () => {
    expect(toScreenerFilter(range('total_value', '1000000', ''))).toEqual({
      filter: { field: 'value', condition: { kind: 'between', min: 1_000_000, max: null } },
    });
    expect(toScreenerFilter(range('last_change_prc', '0', 5))).toEqual({
      filter: { field: 'changePercent', condition: { kind: 'between', min: 0, max: 5 } },
    });
    expect(toScreenerFilter(range('pe_ratio', 0, undefined))).toEqual({
      filter: { field: 'peRatio', condition: { kind: 'between', min: null, max: null } },
    });
    expect(toScreenerFilter(range('pe_ratio', 'abc'))).toEqual({
      unsupported: '"pe_ratio": bounds are not numbers',
    });
  });

  it('maps string arrays, loose strings, strings and numbers', () => {
    expect(
      toScreenerFilter({ filter_key: 'eng_desc', type: 'StringArray', value: '["Banks","Real Estate"]' }),
    ).toEqual({
      filter: { field: 'sector', condition: { kind: 'oneOf', values: ['Banks', 'Real Estate'] } },
    });
    expect(toScreenerFilter({ filter_key: 'eng_desc', type: 'StringArray' })).toEqual({
      filter: { field: 'sector', condition: { kind: 'oneOf', values: [] } },
    });
    expect(toScreenerFilter({ filter_key: 'reuters', type: 'StringLoose', value: 'com' })).toEqual({
      filter: { field: 'ticker', condition: { kind: 'contains', text: 'com' } },
    });
    expect(toScreenerFilter({ filter_key: 'reuters', type: 'StringLoose' })).toEqual({
      filter: { field: 'ticker', condition: { kind: 'contains', text: '' } },
    });
    expect(toScreenerFilter({ filter_key: 'eng_name', type: 'String', value: 'CIB' })).toEqual({
      filter: { field: 'name', condition: { kind: 'equals', value: 'CIB' } },
    });
    expect(toScreenerFilter({ filter_key: 'eng_name', type: 'String', value: null })).toEqual({
      filter: { field: 'name', condition: { kind: 'equals', value: '' } },
    });
    expect(toScreenerFilter({ filter_key: 'eps', type: 'Number', value: '2.5' })).toEqual({
      filter: { field: 'eps', condition: { kind: 'equalsNumber', value: 2.5 } },
    });
  });

  it('explains filters it cannot evaluate', () => {
    expect(toScreenerFilter(range('ref_price', '1'))).toEqual({
      unsupported: 'filter key "ref_price" is not supported',
    });
    expect(toScreenerFilter(range('toString', '1'))).toEqual({
      unsupported: 'filter key "toString" is not supported',
    });
    expect(toScreenerFilter({ filter_key: 'price', type: 'DateRange' })).toEqual({
      unsupported: '"price": filter type "DateRange" is not supported',
    });
    expect(toScreenerFilter({ filter_key: 'price' })).toEqual({
      unsupported: '"price": filter type "" is not supported',
    });
    expect(toScreenerFilter({ filter_key: 'eng_desc', type: 'StringArray', value: '[oops' })).toEqual({
      unsupported: '"eng_desc": value is not a JSON list',
    });
    expect(toScreenerFilter({ filter_key: 'eng_desc', type: 'StringArray', value: '[1]' })).toEqual({
      unsupported: '"eng_desc": value is not a list of strings',
    });
    expect(toScreenerFilter({ filter_key: 'eng_desc', type: 'StringArray', value: '"Banks"' })).toEqual({
      unsupported: '"eng_desc": value is not a list of strings',
    });
    expect(toScreenerFilter({ filter_key: 'eps', type: 'Number', value: 'x' })).toEqual({
      unsupported: '"eps": value is not a number',
    });
    expect(toScreenerFilter({ type: 'Number' })).toEqual({ unsupported: 'a filter without a filter key' });
    expect(toScreenerFilter(null)).toEqual({ unsupported: 'a filter without a filter key' });
  });
});

describe('toScreener', () => {
  it('maps a saved screener, separating unsupported filters, and freezes it', () => {
    const screener = toScreener(
      {
        id: 's1',
        name: 'My value',
        market: 'egypt',
        source: 'thndrx',
        filters: [range('dividend_yield_perc', '4'), range('ref_price', '1')],
      },
      null,
    );
    expect(screener).toEqual({
      id: 's1',
      name: 'My value',
      market: 'egypt',
      preset: false,
      filters: [{ field: 'dividendYieldPercent', condition: { kind: 'between', min: 4, max: null } }],
      unsupported: ['filter key "ref_price" is not supported'],
    });
    expect(Object.isFrozen(screener?.filters[0])).toBe(true);
  });

  it('falls back on the id for the name and on the given market, and rejects payloads without an id', () => {
    expect(toScreener({ id: 's2', market: 'mars' }, 'us')).toMatchObject({
      name: 's2',
      market: 'us',
      filters: [],
      unsupported: [],
    });
    expect(toScreener({ id: ' ' }, null)).toBeNull();
    expect(toScreener(null, null)).toBeNull();
  });
});
