import { describe, expect, it } from 'vitest';
import {
  mergeReturnsSeries,
  PERFORMANCE_PERIODS,
  periodBaseDay,
  periodPerformance,
  timeWeightedReturn,
} from '../performance';
import type { ReturnsPoint } from '../returns';

function point(
  day: string,
  portfolioValue: number | null,
  netDeposits: number | null = 1_000,
  totalReturns: number | null = 0,
): ReturnsPoint {
  return { date: new Date(`${day}T00:00:00Z`), portfolioValue, netDeposits, totalReturns };
}

describe('periodBaseDay', () => {
  it('counts rolling periods back from the latest snapshot and MTD/YTD from today in Cairo', () => {
    const bases = Object.fromEntries(
      PERFORMANCE_PERIODS.map((p) => [p, periodBaseDay(p, '2026-10-05', '2026-10-06')]),
    );
    expect(bases).toEqual({
      '1D': '2026-10-04',
      '7D': '2026-09-28',
      MTD: '2026-09-30',
      '1M': '2026-09-05',
      '6M': '2026-04-05',
      YTD: '2025-12-31',
      '1Y': '2025-10-05',
      '2Y': '2024-10-05',
    });
  });
});

describe('timeWeightedReturn', () => {
  it('chains sub-period returns net of the deposits made in each sub-period', () => {
    // +10% on 100, then a 50 deposit that earns nothing: 10% overall, although the value rose 60%.
    expect(
      timeWeightedReturn([
        { portfolioValue: 100, netDeposits: 100 },
        { portfolioValue: 110, netDeposits: 100 },
        { portfolioValue: 160, netDeposits: 150 },
      ]),
    ).toBe(10);
    // A withdrawal is a negative flow: value falls by the withdrawal only → 0%.
    expect(
      timeWeightedReturn([
        { portfolioValue: 200, netDeposits: 200 },
        { portfolioValue: 150, netDeposits: 150 },
      ]),
    ).toBe(0);
  });

  it('skips sub-periods that start from nothing invested', () => {
    expect(
      timeWeightedReturn([
        { portfolioValue: 0, netDeposits: 0 },
        { portfolioValue: 100, netDeposits: 100 },
        { portfolioValue: 90, netDeposits: 100 },
      ]),
    ).toBe(-10);
    expect(
      timeWeightedReturn([
        { portfolioValue: 0, netDeposits: 0 },
        { portfolioValue: 0, netDeposits: 0 },
      ]),
    ).toBeNull();
  });

  it('is 0 for one point and null without points or net deposits', () => {
    expect(timeWeightedReturn([{ portfolioValue: 5, netDeposits: 5 }])).toBe(0);
    expect(timeWeightedReturn([])).toBeNull();
    expect(
      timeWeightedReturn([
        { portfolioValue: 5, netDeposits: null },
        { portfolioValue: 6, netDeposits: 5 },
      ]),
    ).toBeNull();
  });
});

describe('mergeReturnsSeries', () => {
  it('uses weekly points only before the daily series starts and drops points without a value', () => {
    const daily = [point('2026-04-07', 120), point('2026-04-06', 110), point('2026-04-08', null)];
    const weekly = [point('2026-04-09', 999), point('2026-03-26', 90), point('2026-04-02', 100)];
    const merged = mergeReturnsSeries(daily, weekly);
    expect(merged.map((p) => [p.day, p.granularity, p.portfolioValue])).toEqual([
      ['2026-03-26', 'weekly', 90],
      ['2026-04-02', 'weekly', 100],
      ['2026-04-06', 'daily', 110],
      ['2026-04-07', 'daily', 120],
    ]);
    expect(Object.isFrozen(merged[0])).toBe(true);
  });

  it('falls back to the weekly series alone and keeps missing deposits as null', () => {
    const merged = mergeReturnsSeries(
      [],
      [{ date: new Date('2026-04-02T00:00:00Z'), portfolioValue: 100, totalReturns: null }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ granularity: 'weekly', netDeposits: null });
  });
});

describe('periodPerformance', () => {
  const timeline = mergeReturnsSeries(
    [
      point('2026-04-06', 1_100, 1_000, 10),
      point('2026-04-07', 1_210, 1_000, 15),
      point('2026-04-08', 1_710, 1_500, 40),
    ],
    [point('2026-03-26', 1_000, 1_000, 0), point('2026-04-02', 1_000, 1_000, 5)],
  );

  it('measures from the last point on or before the base day to the latest point', () => {
    const p = periodPerformance('1D', timeline, '2026-04-07');
    expect(p).toMatchObject({
      period: '1D',
      requestedFrom: '2026-04-07',
      from: new Date('2026-04-07T00:00:00Z'),
      to: new Date('2026-04-08T00:00:00Z'),
      partial: false,
      granularity: 'daily',
      startValue: 1_210,
      endValue: 1_710,
      valueChange: 500,
      netDepositsChange: 500,
      gainExcludingDeposits: 0,
      timeWeightedReturnPercent: 0,
      realizedReturnsChange: 25,
    });
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('mixes weekly and daily points when the base is before the daily series', () => {
    const p = periodPerformance('6M', timeline, '2026-04-05');
    expect(p).toMatchObject({
      from: new Date('2026-04-02T00:00:00Z'),
      partial: false,
      granularity: 'weekly+daily',
      valueChange: 710,
      netDepositsChange: 500,
      gainExcludingDeposits: 210,
      timeWeightedReturnPercent: 21,
    });
  });

  it('uses the first point and flags the period partial when the series starts later', () => {
    const p = periodPerformance('2Y', timeline, '2024-10-05');
    expect(p).toMatchObject({ partial: true, from: new Date('2026-03-26T00:00:00Z'), startValue: 1_000 });
    expect(periodPerformance('2Y', timeline.slice(0, 2), '2024-10-05').granularity).toBe('weekly');
  });

  it('handles a base on the latest point, missing figures and an empty series', () => {
    expect(periodPerformance('MTD', timeline, '2026-04-30')).toMatchObject({
      valueChange: 0,
      timeWeightedReturnPercent: 0,
    });
    const sparse = mergeReturnsSeries(
      [point('2026-04-06', 10, null, null), point('2026-04-07', 12, 5, 1)],
      [],
    );
    expect(periodPerformance('1D', sparse, '2026-04-06')).toMatchObject({
      valueChange: 2,
      netDepositsChange: null,
      gainExcludingDeposits: null,
      timeWeightedReturnPercent: null,
      realizedReturnsChange: null,
    });
    expect(periodPerformance('1M', [], '2026-04-06')).toMatchObject({
      partial: true,
      from: null,
      to: null,
      granularity: null,
      startValue: null,
      timeWeightedReturnPercent: null,
    });
  });
});
