import { describe, expect, it } from 'vitest';
import { closes } from '../../../__tests__/support/fake-market-data';
import {
  CLOSE_SPANS,
  closeGranularity,
  createClosePoint,
  mergeCloseSeries,
  sortCloses,
  spanCovering,
} from '../close-series';

const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('close series', () => {
  it('creates immutable, validated close points', () => {
    const point = createClosePoint(new Date('2026-10-06T04:00:00Z'), 239.93);
    expect(Object.isFrozen(point)).toBe(true);
    expect(point).toEqual({ time: new Date('2026-10-06T04:00:00Z'), close: 239.93 });
    expect(() => createClosePoint(new Date('nope'), 1)).toThrow('valid date');
    expect(() => createClosePoint(new Date(), Number.NaN)).toThrow('finite');
  });

  it('picks the shortest span reaching back to the start', () => {
    expect(CLOSE_SPANS).toEqual(['1d', '1w', '1M', '6M', '1y', '2y', 'all']);
    expect(spanCovering(daysAgo(0.5), NOW)).toBe('1d');
    expect(spanCovering(daysAgo(7), NOW)).toBe('1w');
    expect(spanCovering(daysAgo(20), NOW)).toBe('1M');
    expect(spanCovering(daysAgo(160), NOW)).toBe('6M');
    expect(spanCovering(daysAgo(300), NOW)).toBe('1y');
    expect(spanCovering(daysAgo(700), NOW)).toBe('2y');
    expect(spanCovering(daysAgo(1500), NOW)).toBe('all');
  });

  it('labels the spacing of a series', () => {
    expect(closeGranularity([])).toBe('unknown');
    expect(closeGranularity(closes(['2026-10-06T07:00:00Z', 1]))).toBe('unknown');
    expect(closeGranularity(closes(['2026-10-06T07:00:00Z', 1], ['2026-10-06T07:05:00Z', 1]))).toBe(
      'intraday',
    );
    expect(closeGranularity(closes(['2026-10-06T07:00:00Z', 1], ['2026-10-06T08:00:00Z', 1]))).toBe('hourly');
    expect(
      closeGranularity(
        closes(['2026-10-02T04:00:00Z', 1], ['2026-10-05T04:00:00Z', 1], ['2026-10-06T04:00:00Z', 1]),
      ),
    ).toBe('daily');
    expect(closeGranularity(closes(['2026-09-27T04:00:00Z', 1], ['2026-10-04T04:00:00Z', 1]))).toBe('weekly');
    expect(closeGranularity(closes(['2026-08-01T00:00:00Z', 1], ['2026-09-01T00:00:00Z', 1]))).toBe(
      'monthly',
    );
  });

  it('sorts and de-duplicates points, the last one given winning', () => {
    const sorted = sortCloses(
      closes(['2026-10-06T04:00:00Z', 2], ['2026-10-05T04:00:00Z', 1], ['2026-10-06T04:00:00Z', 3]),
    );
    expect(sorted.map((p) => p.close)).toEqual([1, 3]);
  });

  it('joins series finest first, older points only from the coarser ones', () => {
    const month = closes(['2026-09-08T04:00:00Z', 225], ['2026-10-06T04:00:00Z', 240]);
    const year = closes(
      ['2025-10-13T00:00:00Z', 100],
      ['2026-09-08T00:00:00Z', 999],
      ['2026-09-10T00:00:00Z', 999],
    );
    const all = closes(
      ['2021-10-03T04:00:00Z', 20],
      ['2025-10-12T04:00:00Z', 95],
      ['2026-01-04T05:00:00Z', 999],
    );
    expect(mergeCloseSeries(month, [], year, all).map((p) => p.close)).toEqual([20, 95, 100, 225, 240]);
    expect(mergeCloseSeries()).toEqual([]);
  });
});
