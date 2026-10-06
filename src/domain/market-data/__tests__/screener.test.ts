import { describe, expect, it } from 'vitest';
import { aQuote } from '../../../__tests__/support/fake-market-data';
import {
  deepFreeze,
  describeFilter,
  matchesFilter,
  matchesScreener,
  SCREENER_FIELDS,
  SCREENER_PRESET_IDS,
  SCREENER_PRESETS,
  type ScreenerCondition,
  type ScreenerField,
  screenerValue,
} from '../screener';

const between = (min: number | null, max: number | null): ScreenerCondition => ({
  kind: 'between',
  min,
  max,
});
const f = (field: ScreenerField, condition: ScreenerCondition) => ({ field, condition });

describe('screenerValue (ThndrX module 86697)', () => {
  it('derives price, change and change % from the last trade price and previous close', () => {
    const q = aQuote({ last: 110, previousClose: 100 });
    expect(screenerValue(q, 'price')).toBe(110);
    expect(screenerValue(q, 'change')).toBe(10);
    expect(screenerValue(q, 'changePercent')).toBeCloseTo(10);
  });

  it('keeps ThndrX quirks before the first trade of the day (last trade price 0)', () => {
    const q = aQuote({ last: 8.1, lastTradePrice: 0, previousClose: 8.1, week52High: 9, week52Low: 7 });
    expect(screenerValue(q, 'price')).toBe(8.1); // falls back to the close
    expect(screenerValue(q, 'change')).toBeCloseTo(-8.1);
    expect(screenerValue(q, 'changePercent')).toBe(-100);
    expect(screenerValue(q, 'week52HighDistance')).toBe(0);
    expect(screenerValue(q, 'week52LowDistance')).toBe(0);
    expect(screenerValue(aQuote({ last: null, lastTradePrice: 0 }), 'price')).toBe(0);
    expect(screenerValue(aQuote({ lastTradePrice: null }), 'price')).toBeNull();
  });

  it('treats missing numbers as 0 like ThndrX (`?? 0`)', () => {
    const q = aQuote({ lastTradePrice: null, previousClose: null, week52High: null });
    expect(screenerValue(q, 'change')).toBe(0);
    expect(screenerValue(q, 'changePercent')).toBeNaN();
    expect(screenerValue(q, 'week52HighDistance')).toBe(0);
  });

  it('rounds relative volume to an integer and makes it null without volume or average', () => {
    expect(screenerValue(aQuote({ volume: 1234, averageVolume30d: 1000 }), 'relativeVolume')).toBe(123);
    expect(screenerValue(aQuote({ volume: 1235, averageVolume30d: 1000 }), 'relativeVolume')).toBe(124);
    expect(screenerValue(aQuote({ volume: 0 }), 'relativeVolume')).toBeNull();
    expect(screenerValue(aQuote({ volume: null }), 'relativeVolume')).toBeNull();
    expect(screenerValue(aQuote({ averageVolume30d: null }), 'relativeVolume')).toBeNull();
  });

  it('measures the 52-week distances as rounded absolute percentages of the reference', () => {
    const q = aQuote({ last: 90, week52High: 100, week52Low: 60 });
    expect(screenerValue(q, 'week52HighDistance')).toBe(10);
    expect(screenerValue(q, 'week52LowDistance')).toBe(50);
    expect(screenerValue(aQuote({ last: 104.6, week52High: 100 }), 'week52HighDistance')).toBe(5);
  });

  it('reads plain fields from the quote', () => {
    const q = aQuote({ ticker: 'COMI', sector: 'Banks', value: 5, averageVolume5d: 7 });
    expect(screenerValue(q, 'ticker')).toBe('COMI');
    expect(screenerValue(q, 'sector')).toBe('Banks');
    expect(screenerValue(q, 'value')).toBe(5);
    expect(screenerValue(q, 'averageVolume5d')).toBe(7);
    for (const field of SCREENER_FIELDS) expect(() => screenerValue(q, field)).not.toThrow();
  });
});

describe('matchesFilter', () => {
  it('applies inclusive ranges with open bounds, and Number(null) = 0', () => {
    const q = aQuote({ value: 1000, peRatio: null });
    expect(matchesFilter(q, f('value', between(1000, 1000)))).toBe(true);
    expect(matchesFilter(q, f('value', between(1001, null)))).toBe(false);
    expect(matchesFilter(q, f('value', between(null, 999)))).toBe(false);
    expect(matchesFilter(q, f('value', between(null, null)))).toBe(true);
    expect(matchesFilter(q, f('peRatio', between(null, 10)))).toBe(true); // null counts as 0, as in ThndrX
    expect(matchesFilter(q, f('ticker', between(null, null)))).toBe(false); // NaN
  });

  it('rejects a row whose relative volume cannot be computed, whatever the condition', () => {
    expect(matchesFilter(aQuote({ volume: 0 }), f('relativeVolume', between(null, null)))).toBe(false);
  });

  it('matches one-of, contains, equals and number equality', () => {
    const q = aQuote({ sector: 'Real Estate', name: 'Talaat Moustafa', eps: 2, ticker: 'TMGH' });
    expect(matchesFilter(q, f('sector', { kind: 'oneOf', values: ['Banks', 'Real Estate'] }))).toBe(true);
    expect(matchesFilter(q, f('sector', { kind: 'oneOf', values: ['real estate'] }))).toBe(false);
    expect(matchesFilter(aQuote({ sector: null }), f('sector', { kind: 'oneOf', values: [''] }))).toBe(false);
    expect(matchesFilter(q, f('name', { kind: 'contains', text: 'MOUSTAFA' }))).toBe(true);
    expect(matchesFilter(aQuote({ name: null }), f('name', { kind: 'contains', text: '' }))).toBe(true);
    expect(matchesFilter(q, f('ticker', { kind: 'equals', value: 'TMGH' }))).toBe(true);
    expect(matchesFilter(aQuote({ name: null }), f('name', { kind: 'equals', value: '' }))).toBe(true);
    expect(matchesFilter(q, f('eps', { kind: 'equalsNumber', value: 2 }))).toBe(true);
    expect(matchesFilter(q, f('eps', { kind: 'equalsNumber', value: 3 }))).toBe(false);
  });

  it('requires every filter of a screener', () => {
    const q = aQuote({ value: 10, dividendYieldPercent: 5 });
    expect(matchesScreener(q, [])).toBe(true);
    expect(
      matchesScreener(q, [f('value', between(5, null)), f('dividendYieldPercent', between(4, null))]),
    ).toBe(true);
    expect(
      matchesScreener(q, [f('value', between(5, null)), f('dividendYieldPercent', between(6, null))]),
    ).toBe(false);
  });
});

describe('SCREENER_PRESETS', () => {
  it("lists ThndrX's five recommended screeners, frozen", () => {
    expect(SCREENER_PRESETS.map((p) => p.id)).toEqual([...SCREENER_PRESET_IDS]);
    expect(SCREENER_PRESETS.map((p) => p.name)).toEqual([
      'Momentum Movers',
      'Breakout Radar',
      'Value & Yield',
      'Steady Performers',
      'Reversal Watch',
    ]);
    for (const preset of SCREENER_PRESETS) {
      expect(preset).toMatchObject({ preset: true, market: null, unsupported: [] });
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.filters[0]?.condition)).toBe(true);
    }
    expect(Object.isFrozen(SCREENER_PRESETS)).toBe(true);
  });

  it('copies the exact ThndrX filters', () => {
    expect(SCREENER_PRESETS.map((p) => p.filters.map(describeFilter))).toEqual([
      ['value ≥ 1,000,000', 'relativeVolume ≥ 100', 'week52HighDistance ≤ 10', 'changePercent ≥ 2'],
      ['value ≥ 2,000,000', 'relativeVolume ≥ 100', 'week52HighDistance ≤ 5', 'changePercent ≥ 0'],
      [
        'week52HighDistance ≤ 20',
        'dividendYieldPercent ≥ 4',
        'sector is one of Non-bank financial services, Real Estate, Textile & Durables, Basic Resources',
      ],
      ['relativeVolume ≥ 70', 'week52HighDistance ≤ 15', 'changePercent ≥ 0', 'dividendYieldPercent ≥ 2'],
      ['relativeVolume ≥ 100', 'week52LowDistance ≤ 5', 'changePercent ≥ -2'],
    ]);
  });

  it('screens a momentum mover', () => {
    const momentum = SCREENER_PRESETS[0]!.filters;
    const mover = aQuote({
      value: 2_000_000,
      volume: 200,
      averageVolume30d: 100,
      last: 95,
      previousClose: 90,
      week52High: 100,
    });
    expect(matchesScreener(mover, momentum)).toBe(true);
    expect(matchesScreener({ ...mover, week52High: 120 }, momentum)).toBe(false);
  });
});

describe('describeFilter', () => {
  it('words every condition', () => {
    expect(describeFilter(f('peRatio', between(5, 10.5)))).toBe('5 ≤ peRatio ≤ 10.5');
    expect(describeFilter(f('peRatio', between(null, null)))).toBe('peRatio (any value)');
    expect(describeFilter(f('name', { kind: 'contains', text: 'bank' }))).toBe('name contains "bank"');
    expect(describeFilter(f('ticker', { kind: 'equals', value: 'COMI' }))).toBe('ticker = "COMI"');
    expect(describeFilter(f('eps', { kind: 'equalsNumber', value: 1500 }))).toBe('eps = 1,500');
  });
});

describe('deepFreeze', () => {
  it('freezes nested values and leaves primitives alone', () => {
    const value = deepFreeze({ a: { b: [1] } });
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
  });
});
