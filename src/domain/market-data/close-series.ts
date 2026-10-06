import { ValidationError } from '../shared-kernel/errors';

/**
 * Closing-price history (ADR 0021). Outside Egypt Thndr has no OHLC candles: it serves a series of closing prices per
 * trailing span, at a granularity it picks per span (e.g. hourly for a week, daily for a month, weekly for "all").
 * A close point is only a close: thndr-mcp never derives open, high or low values from it.
 */
export interface ClosePoint {
  readonly time: Date;
  readonly close: number;
}

export function createClosePoint(time: Date, close: number): ClosePoint {
  if (Number.isNaN(time.getTime())) throw new ValidationError('Close time must be a valid date');
  if (!Number.isFinite(close)) throw new ValidationError('Close must be a finite number');
  return Object.freeze({ time: new Date(time.getTime()), close });
}

/** Trailing spans Thndr serves closing prices for, shortest first; `all` reaches back about 5 years. */
export const CLOSE_SPANS = ['1d', '1w', '1M', '6M', '1y', '2y', 'all'] as const;
export type CloseSpan = (typeof CLOSE_SPANS)[number];

/** Calendar days each bounded span reaches back. */
export const CLOSE_SPAN_DAYS: Readonly<Record<Exclude<CloseSpan, 'all'>, number>> = {
  '1d': 1,
  '1w': 7,
  '1M': 31,
  '6M': 183,
  '1y': 366,
  '2y': 731,
};

const DAY_MS = 86_400_000;

/** The shortest span whose trailing window (ending now) reaches back to `from`. */
export function spanCovering(from: Date, now: Date): CloseSpan {
  const days = (now.getTime() - from.getTime()) / DAY_MS;
  for (const span of CLOSE_SPANS) {
    if (span === 'all') break;
    if (days <= CLOSE_SPAN_DAYS[span]) return span;
  }
  return 'all';
}

/** How far apart the points of a close series are (Thndr chooses it per span). */
export type CloseGranularity = 'intraday' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'unknown';

/** The granularity of a series from the median gap between consecutive points; `unknown` below two points. */
export function closeGranularity(points: readonly ClosePoint[]): CloseGranularity {
  const times = points.map((p) => p.time.getTime()).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
  if (gaps.length === 0) return 'unknown';
  gaps.sort((a, b) => a - b);
  // Lower median: a single long jump (e.g. a listing gap) does not change the label of a short series.
  const median = gaps[Math.floor((gaps.length - 1) / 2)] as number;
  const hour = 3_600_000;
  if (median < hour) return 'intraday';
  if (median < 6 * hour) return 'hourly';
  if (median < 3 * DAY_MS) return 'daily';
  if (median < 15 * DAY_MS) return 'weekly';
  return 'monthly';
}

/** Oldest first, one point per instant (the last one given wins). */
export function sortCloses(points: readonly ClosePoint[]): ClosePoint[] {
  const byTime = new Map<number, ClosePoint>();
  for (const point of points) byTime.set(point.time.getTime(), point);
  return [...byTime.values()].sort((a, b) => a.time.getTime() - b.time.getTime());
}

/** A coarser series' point this close to the earliest kept one is the same session stamped differently. */
const SAME_SESSION_MS = 12 * 3_600_000;

/**
 * Joins series of different spans, finest first: every point of the first series is kept, and each following series
 * only adds the points more than 12 hours older than everything kept so far (Thndr stamps a day's close at 00:00Z in
 * one span and 04:00Z in another). The result is oldest first.
 */
export function mergeCloseSeries(...seriesFinestFirst: ReadonlyArray<readonly ClosePoint[]>): ClosePoint[] {
  const kept: ClosePoint[] = [];
  let earliest = Number.POSITIVE_INFINITY;
  for (const series of seriesFinestFirst) {
    const sorted = sortCloses(series);
    const older = sorted.filter((p) => p.time.getTime() < earliest - SAME_SESSION_MS);
    kept.push(...older);
    if (sorted.length > 0) earliest = Math.min(earliest, (sorted[0] as ClosePoint).time.getTime());
  }
  return sortCloses(kept);
}
