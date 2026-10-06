import { describe, expect, it } from 'vitest';
import { parseReturnsInterval, summarizeReturnsSeries } from '../../../src/domain/portfolio/returns';

describe('parseReturnsInterval', () => {
  it('defaults to 1M and normalises case', () => {
    expect(parseReturnsInterval(undefined)).toBe('1M');
    expect(parseReturnsInterval(null)).toBe('1M');
    expect(parseReturnsInterval('')).toBe('1M');
    expect(parseReturnsInterval(' 1y ')).toBe('1Y');
    expect(() => parseReturnsInterval('5Y')).toThrow(/Unsupported returns interval/);
  });
});

describe('summarizeReturnsSeries', () => {
  it('summarises first vs last point, sorting defensively', () => {
    const s = summarizeReturnsSeries([
      { date: new Date('2026-02-01'), totalReturns: 300, portfolioValue: 11_000 },
      { date: new Date('2026-01-01'), totalReturns: 100, portfolioValue: 10_000 },
    ]);
    expect(s.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(s.to?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(s.returnsChange).toBe(200);
    expect(s.portfolioValueChange).toBe(1_000);
    expect(s.portfolioValueChangePercent).toBe(10);
  });

  it('returns nulls when data is missing', () => {
    expect(summarizeReturnsSeries([])).toEqual({
      from: null,
      to: null,
      returnsChange: null,
      portfolioValueChange: null,
      portfolioValueChangePercent: null,
    });
    const s = summarizeReturnsSeries([
      { date: new Date('2026-01-01'), totalReturns: null, portfolioValue: 0 },
      { date: new Date('2026-01-02'), totalReturns: 5, portfolioValue: 10 },
    ]);
    expect(s.returnsChange).toBeNull();
    expect(s.portfolioValueChange).toBe(10);
    expect(s.portfolioValueChangePercent).toBeNull();
  });
});
