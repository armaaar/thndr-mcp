import { ValidationError } from '../shared-kernel/errors';
import { roundTo } from '../shared-kernel/guards';

export const RETURNS_INTERVALS = ['1M', '6M', '1Y', '2Y'] as const;
export type ReturnsInterval = (typeof RETURNS_INTERVALS)[number];

export function parseReturnsInterval(raw: string | undefined | null): ReturnsInterval {
  if (raw === undefined || raw === null || raw === '') return '1M';
  const value = raw.trim().toUpperCase();
  if (!(RETURNS_INTERVALS as readonly string[]).includes(value)) {
    throw new ValidationError(
      `Unsupported returns interval "${raw}". Use one of: ${RETURNS_INTERVALS.join(', ')}`,
    );
  }
  return value as ReturnsInterval;
}

/** Cumulative realized returns as of a snapshot date. */
export interface RealizedReturns {
  readonly totalReturns: number | null;
  readonly snapshotDate: Date | null;
}

export interface ReturnsPoint {
  readonly date: Date;
  readonly totalReturns: number | null;
  readonly portfolioValue: number | null;
}

export interface ReturnsSeriesSummary {
  readonly from: Date | null;
  readonly to: Date | null;
  /** Realized returns booked over the window (last - first). */
  readonly returnsChange: number | null;
  readonly portfolioValueChange: number | null;
  readonly portfolioValueChangePercent: number | null;
}

/** Summarises a returns series (expects oldest first, as Thndr sends it; sorts defensively). */
export function summarizeReturnsSeries(points: readonly ReturnsPoint[]): ReturnsSeriesSummary {
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  const last = sorted.at(-1);
  const diff = (a: number | null | undefined, b: number | null | undefined) =>
    typeof a === 'number' && typeof b === 'number' ? roundTo(b - a, 4) : null;
  const portfolioValueChange = diff(first?.portfolioValue, last?.portfolioValue);
  const startValue = first?.portfolioValue;
  return Object.freeze({
    from: first?.date ?? null,
    to: last?.date ?? null,
    returnsChange: diff(first?.totalReturns, last?.totalReturns),
    portfolioValueChange,
    portfolioValueChangePercent:
      portfolioValueChange !== null && typeof startValue === 'number' && startValue > 0
        ? roundTo((portfolioValueChange / startValue) * 100, 4)
        : null,
  });
}
