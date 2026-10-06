import { describe, expect, it } from 'vitest';
import { aCandle } from '../../../__tests__/support/fake-market-data';
import {
  closePerformance,
  marketDay,
  pricePerformance,
  shiftDay,
  TRADING_DAYS_PER_YEAR,
} from '../performance';

const c = (day: string, close: number, high = close, low = close) =>
  aCandle({ time: new Date(`${day}T00:00:00Z`), open: close, high, low, close, volume: 1 });

/** Consecutive calendar days ending on `last`, one close each. */
function daily(last: string, closes: number[]) {
  return closes.map((close, i) => c(shiftDay(last, 0, i - closes.length + 1), close));
}

describe('calendar helpers', () => {
  it('reads the Cairo market day of an instant', () => {
    expect(marketDay(new Date('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
    expect(marketDay(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01-15');
  });

  it('shifts days by months (clamping month ends) and days', () => {
    expect(shiftDay('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftDay('2024-03-31', -1)).toBe('2024-02-29');
    expect(shiftDay('2026-01-05', 0, -7)).toBe('2025-12-29');
    expect(shiftDay('2026-10-06', -60)).toBe('2021-10-06');
  });
});

describe('pricePerformance', () => {
  it('returns nothing without candles', () => {
    expect(pricePerformance([])).toEqual({
      asOf: null,
      lastClose: null,
      firstDate: null,
      sessions: 0,
      returns: [],
      volatility: [],
      week52: null,
      maxDrawdown1Y: null,
    });
  });

  it('computes close-to-close returns from the last close on or before each period start', () => {
    const stats = pricePerformance([
      c('2026-10-06', 121),
      c('2025-12-30', 100),
      c('2026-09-29', 110),
      c('2026-10-05', 120),
      c('2023-10-01', 50),
    ]);
    expect(stats).toMatchObject({ asOf: '2026-10-06', lastClose: 121, firstDate: '2023-10-01', sessions: 5 });
    const byPeriod = Object.fromEntries(stats.returns.map((r) => [r.period, r]));
    expect(byPeriod['1W']).toEqual({
      period: '1W',
      startDate: '2026-09-29',
      baseDate: '2026-09-29',
      baseClose: 110,
      returnPercent: expect.closeTo(10, 10),
    });
    expect(byPeriod.YTD).toMatchObject({ startDate: '2025-12-31', baseDate: '2025-12-30', baseClose: 100 });
    expect(byPeriod.YTD?.returnPercent).toBeCloseTo(21);
    expect(byPeriod['1M']).toMatchObject({ startDate: '2026-09-06', baseDate: '2025-12-30' });
    expect(byPeriod['3Y']).toMatchObject({ startDate: '2023-10-06', baseDate: '2023-10-01', baseClose: 50 });
    expect(byPeriod['5Y']).toEqual({
      period: '5Y',
      startDate: '2021-10-06',
      baseDate: null,
      baseClose: null,
      returnPercent: null,
    });
    expect(stats.returns.map((r) => r.period)).toEqual(['1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y']);
  });

  it('bases a period on the first close within 7 days after its start when none is on or before it', () => {
    // 5Y starts 2021-10-06; Thndr's ~5 years of candles begin a few days later.
    const inWindow = pricePerformance([c('2021-10-13', 50), c('2026-10-06', 100)]);
    expect(inWindow.returns.find((r) => r.period === '5Y')).toEqual({
      period: '5Y',
      startDate: '2021-10-06',
      baseDate: '2021-10-13',
      baseClose: 50,
      returnPercent: 100,
    });
    const tooLate = pricePerformance([c('2021-10-14', 50), c('2026-10-06', 100)]);
    expect(tooLate.returns.find((r) => r.period === '5Y')).toMatchObject({
      baseDate: null,
      returnPercent: null,
    });
    // A close on or before the start still wins over a later one.
    const before = pricePerformance([c('2021-10-04', 40), c('2021-10-07', 50), c('2026-10-06', 100)]);
    expect(before.returns.find((r) => r.period === '5Y')).toMatchObject({
      baseDate: '2021-10-04',
      baseClose: 40,
    });
  });

  it('groups candles by Cairo day across the UTC midnight boundary', () => {
    const stats = pricePerformance([
      aCandle({ time: new Date('2026-01-14T21:30:00Z'), close: 9, high: 9, low: 9 }), // 23:30 on the 14th in Cairo
      aCandle({ time: new Date('2026-01-14T22:30:00Z'), close: 10, high: 10, low: 10 }), // 00:30 on the 15th in Cairo
      aCandle({ time: new Date('2026-01-15T09:00:00Z'), close: 12, high: 12, low: 12 }),
    ]);
    expect(stats).toMatchObject({ sessions: 2, firstDate: '2026-01-14', asOf: '2026-01-15', lastClose: 12 });
    expect(stats.returns.find((r) => r.period === '1W')).toMatchObject({ baseClose: 9 });
  });

  it('keeps one session per market day (the latest candle) and ignores non-positive closes', () => {
    const stats = pricePerformance([
      aCandle({ time: new Date('2026-10-06T07:00:00Z'), close: 10, high: 10, low: 10 }),
      aCandle({ time: new Date('2026-10-06T09:00:00Z'), close: 12, high: 12, low: 12 }),
      c('2026-10-05', 0, 0, 0),
    ]);
    expect(stats).toMatchObject({ sessions: 1, lastClose: 12, firstDate: '2026-10-06' });
  });

  it('annualises the sample standard deviation of daily log returns', () => {
    const closes = Array.from({ length: 31 }, (_, i) => (i % 2 === 0 ? 100 : 110));
    const stats = pricePerformance(daily('2026-10-06', closes));
    const a = Math.log(1.1);
    const expected = a * Math.sqrt(30 / 29) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
    expect(stats.volatility).toEqual([
      { window: '30D', tradingDays: 30, annualisedPercent: expect.closeTo(expected, 8) },
      { window: '90D', tradingDays: 90, annualisedPercent: null },
      { window: '1Y', tradingDays: 252, annualisedPercent: null },
    ]);
  });

  it('finds the 52-week range from daily highs and lows of the last year only', () => {
    const stats = pricePerformance([
      c('2025-10-01', 100, 500, 1),
      c('2025-10-07', 100, 130, 90),
      c('2026-03-01', 100, 140, 95),
      c('2026-06-01', 100, 120, 80),
      c('2026-10-06', 100, 110, 85),
    ]);
    expect(stats.week52).toEqual({
      basis: 'high-low',
      high: 140,
      highDate: '2026-03-01',
      low: 80,
      lowDate: '2026-06-01',
    });
  });

  it('starts the 52-week range the day after the 1Y start and ignores lows ≤ 0', () => {
    const stats = pricePerformance([
      c('2025-10-06', 100, 900, 1), // exactly 12 months back: outside the range
      c('2025-10-07', 100, 130, 0), // bad low: the close counts instead
      c('2026-03-01', 100, 140, 95),
      c('2026-10-06', 99, 110, -5), // bad low: the close counts instead
    ]);
    expect(stats.week52).toEqual({
      basis: 'high-low',
      high: 140,
      highDate: '2026-03-01',
      low: 95,
      lowDate: '2026-03-01',
    });
    const lowClose = pricePerformance([c('2026-03-01', 100, 140, 95), c('2026-10-06', 90, 110, 0)]);
    expect(lowClose.week52).toMatchObject({ low: 90, lowDate: '2026-10-06' });
  });

  it('keeps the first of tied peaks for the drawdown', () => {
    const stats = pricePerformance([
      c('2026-01-01', 100),
      c('2026-02-01', 100),
      c('2026-03-01', 80),
      c('2026-10-06', 90),
    ]);
    expect(stats.maxDrawdown1Y).toEqual({
      percent: expect.closeTo(-20, 10),
      peakDate: '2026-01-01',
      troughDate: '2026-03-01',
    });
  });

  it('measures the 1-year maximum drawdown on closes from the 1Y base', () => {
    const stats = pricePerformance([
      c('2025-01-01', 1000),
      c('2025-10-01', 100),
      c('2026-01-10', 150),
      c('2026-04-01', 75),
      c('2026-05-01', 140),
      c('2026-06-01', 90),
      c('2026-10-06', 120),
    ]);
    expect(stats.maxDrawdown1Y).toEqual({ percent: -50, peakDate: '2026-01-10', troughDate: '2026-04-01' });
  });

  it('reports no drawdown for a rising series and none from a single session', () => {
    expect(pricePerformance(daily('2026-10-06', [1, 2, 3])).maxDrawdown1Y).toEqual({
      percent: 0,
      peakDate: '2026-10-04',
      troughDate: '2026-10-04',
    });
    expect(pricePerformance([c('2026-10-06', 5)]).maxDrawdown1Y).toBeNull();
  });

  describe('closePerformance', () => {
    const point = (day: string, close: number) => ({ time: new Date(`${day}T04:00:00Z`), close });

    it('returns nothing without closes', () => {
      expect(closePerformance([])).toMatchObject({ asOf: null, sessions: 0, week52: null, volatility: [] });
    });

    it('takes the 52-week range from closes and labels it', () => {
      const stats = closePerformance([
        point('2025-12-01', 50),
        point('2026-03-02', 80),
        point('2026-10-06', 70),
      ]);
      expect(stats.week52).toEqual({
        basis: 'close',
        high: 80,
        highDate: '2026-03-02',
        low: 50,
        lowDate: '2025-12-01',
      });
    });

    it('computes volatility from the trailing daily run only, never across weekly gaps', () => {
      const weekly = Array.from({ length: 40 }, (_, i) =>
        point(shiftDay('2025-01-05', 0, i * 7), i % 2 ? 50 : 150),
      );
      const dailyRun = Array.from({ length: 40 }, (_, i) =>
        point(shiftDay('2026-09-01', 0, i), 100 + (i % 2)),
      );
      const stats = closePerformance([...weekly, ...dailyRun]);
      const vol30 = stats.volatility.find((v) => v.window === '30D')?.annualisedPercent as number;
      // Daily swings of ~1% annualise far below the weekly 50↔150 swings.
      expect(vol30).toBeGreaterThan(0);
      expect(vol30).toBeLessThan(30);
      expect(stats.volatility.find((v) => v.window === '90D')?.annualisedPercent).toBeNull();
    });
  });
});
