import { roundTo } from '../shared-kernel/guards';
import { addDays, addMonths, marketDay, startOfMonth, startOfYear } from './period';
import type { ReturnsPoint } from './returns';

/** Periods reported by the portfolio performance query. */
export const PERFORMANCE_PERIODS = ['1D', '7D', 'MTD', '1M', '6M', 'YTD', '1Y', '2Y'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

/** Spacing of the returns-chart points a figure was computed from. */
export type SeriesGranularity = 'daily' | 'weekly';
export type WindowGranularity = SeriesGranularity | 'weekly+daily';

/** A returns-chart point with a known portfolio value, tagged with the series it came from. */
export interface PerformancePoint {
  readonly date: Date;
  /** Cairo calendar day of the snapshot. */
  readonly day: string;
  readonly portfolioValue: number;
  readonly netDeposits: number | null;
  readonly totalReturns: number | null;
  readonly granularity: SeriesGranularity;
}

/** Performance of the portfolio over one period, derived from Thndr's returns chart. */
export interface PeriodPerformance {
  readonly period: PerformancePeriod;
  /** The snapshot day the period is measured from (the close before the period's first day). */
  readonly requestedFrom: string;
  /** Snapshot dates actually used (base and end points). */
  readonly from: Date | null;
  readonly to: Date | null;
  /** True when the series starts after `requestedFrom`, so the window is shorter than the period. */
  readonly partial: boolean;
  readonly granularity: WindowGranularity | null;
  readonly startValue: number | null;
  readonly endValue: number | null;
  /** `endValue − startValue`. */
  readonly valueChange: number | null;
  /** Change of cumulative net deposits (deposits − withdrawals) over the window. */
  readonly netDepositsChange: number | null;
  /** `valueChange − netDepositsChange`: what the portfolio earned, excluding money moved in or out. */
  readonly gainExcludingDeposits: number | null;
  /** Time-weighted return over the window, in percent; see {@link timeWeightedReturn}. */
  readonly timeWeightedReturnPercent: number | null;
  /** Change of Thndr's cumulative realized returns over the window. */
  readonly realizedReturnsChange: number | null;
}

/**
 * The snapshot day a period is measured from. A snapshot dated D is the close of D, so a period whose first day is
 * F is measured from the last snapshot on or before F − 1. Rolling periods count back from `endDay` (the latest
 * snapshot, which lags today by a day); `MTD`/`YTD` start on the 1st of today's month/year in Cairo.
 */
export function periodBaseDay(period: PerformancePeriod, endDay: string, today: string): string {
  switch (period) {
    case '1D':
      return addDays(endDay, -1);
    case '7D':
      return addDays(endDay, -7);
    case '1M':
      return addMonths(endDay, -1);
    case '6M':
      return addMonths(endDay, -6);
    case '1Y':
      return addMonths(endDay, -12);
    case '2Y':
      return addMonths(endDay, -24);
    case 'MTD':
      return addDays(startOfMonth(today), -1);
    case 'YTD':
      return addDays(startOfYear(today), -1);
  }
}

function toPerformancePoints(
  points: readonly ReturnsPoint[],
  granularity: SeriesGranularity,
): PerformancePoint[] {
  return points
    .filter((p): p is ReturnsPoint & { portfolioValue: number } => typeof p.portfolioValue === 'number')
    .map((p) =>
      Object.freeze({
        date: p.date,
        day: marketDay(p.date),
        portfolioValue: p.portfolioValue,
        netDeposits: typeof p.netDeposits === 'number' ? p.netDeposits : null,
        totalReturns: p.totalReturns,
        granularity,
      }),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * One timeline from a daily and a weekly series: the weekly points before the daily series starts, then the daily
 * points. Points without a portfolio value are dropped; both inputs may arrive in any order.
 */
export function mergeReturnsSeries(
  daily: readonly ReturnsPoint[],
  weekly: readonly ReturnsPoint[],
): PerformancePoint[] {
  const fine = toPerformancePoints(daily, 'daily');
  const coarse = toPerformancePoints(weekly, 'weekly');
  const firstFine = fine[0]?.day;
  return [...(firstFine === undefined ? coarse : coarse.filter((p) => p.day < firstFine)), ...fine];
}

/**
 * Time-weighted return of consecutive points, in percent (4 decimals). Sub-period returns are chained:
 * `r_i = (V_i − ΔD_i) / V_{i−1} − 1`, where `ΔD_i` is the change of net deposits between the two snapshots.
 * Cash-flow timing assumption: money moved in or out during a sub-period arrives at its end, just before the closing
 * valuation, so it earns nothing in that sub-period. Sub-periods that start from a value ≤ 0 are skipped (nothing
 * was invested). Null when a point lacks net deposits or no sub-period could be used; 0 for a single point.
 */
export function timeWeightedReturn(
  points: readonly Pick<PerformancePoint, 'portfolioValue' | 'netDeposits'>[],
): number | null {
  if (points.length === 0 || points.some((p) => p.netDeposits === null)) return null;
  if (points.length === 1) return 0;
  let growth = 1;
  let used = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1] as PerformancePoint;
    const current = points[i] as PerformancePoint;
    if (previous.portfolioValue <= 0) continue;
    const flow = (current.netDeposits as number) - (previous.netDeposits as number);
    growth *= (current.portfolioValue - flow) / previous.portfolioValue;
    used += 1;
  }
  return used === 0 ? null : roundTo((growth - 1) * 100, 4);
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : roundTo(b - a, 4);
}

/**
 * Performance over one period of a merged timeline (oldest first). The base is the last point on or before
 * `baseDay`; when the timeline starts later, its first point is used and the period is flagged `partial`. The end is
 * the latest point.
 */
export function periodPerformance(
  period: PerformancePeriod,
  timeline: readonly PerformancePoint[],
  baseDay: string,
): PeriodPerformance {
  let baseIndex = -1;
  for (let i = 0; i < timeline.length; i++) {
    if ((timeline[i] as PerformancePoint).day <= baseDay) baseIndex = i;
  }
  const partial = baseIndex === -1;
  const window = timeline.slice(partial ? 0 : baseIndex);
  const start = window[0];
  const end = window.at(-1);
  if (!start || !end) {
    return Object.freeze({
      period,
      requestedFrom: baseDay,
      from: null,
      to: null,
      partial: true,
      granularity: null,
      startValue: null,
      endValue: null,
      valueChange: null,
      netDepositsChange: null,
      gainExcludingDeposits: null,
      timeWeightedReturnPercent: null,
      realizedReturnsChange: null,
    });
  }
  const kinds = new Set(window.map((p) => p.granularity));
  const granularity: WindowGranularity = kinds.size > 1 ? 'weekly+daily' : start.granularity;
  const valueChange = diff(start.portfolioValue, end.portfolioValue);
  const netDepositsChange = diff(start.netDeposits, end.netDeposits);
  return Object.freeze({
    period,
    requestedFrom: baseDay,
    from: start.date,
    to: end.date,
    partial,
    granularity,
    startValue: start.portfolioValue,
    endValue: end.portfolioValue,
    valueChange,
    netDepositsChange,
    gainExcludingDeposits: diff(netDepositsChange, valueChange),
    timeWeightedReturnPercent: timeWeightedReturn(window),
    realizedReturnsChange: diff(start.totalReturns, end.totalReturns),
  });
}
