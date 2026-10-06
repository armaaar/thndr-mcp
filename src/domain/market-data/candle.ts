import { ValidationError } from '../shared/errors.js';

export const CANDLE_RESOLUTIONS = ['1min', '5min', '10min', '1h', '1d', '1w'] as const;
export type CandleResolution = (typeof CANDLE_RESOLUTIONS)[number];

export const RESOLUTION_MS: Record<CandleResolution, number> = {
  '1min': 60_000,
  '5min': 300_000,
  '10min': 600_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
};

export interface Candle {
  readonly time: Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export function createCandle(input: Candle): Candle {
  const { open, high, low, close, volume } = input;
  for (const [label, value] of Object.entries({ open, high, low, close, volume })) {
    if (!Number.isFinite(value)) throw new ValidationError(`Candle ${label} must be a finite number`);
  }
  if (Number.isNaN(input.time.getTime())) throw new ValidationError('Candle time must be a valid date');
  if (high < low) throw new ValidationError('Candle high must be >= low');
  return Object.freeze({ ...input, time: new Date(input.time.getTime()) });
}

/** Thndr serves at most ~5 years of history. */
export const MAX_HISTORY_MS = 5 * 365 * 86_400_000;

/** Validates and clamps a requested history window. */
export function historyWindow(from: Date, to: Date, now: Date): { from: Date; to: Date } {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('History window dates must be valid');
  }
  if (from.getTime() >= to.getTime()) throw new ValidationError('History "from" must be before "to"');
  const earliest = now.getTime() - MAX_HISTORY_MS;
  const clampedFrom = Math.max(from.getTime(), earliest);
  const clampedTo = Math.min(to.getTime(), now.getTime());
  if (clampedFrom >= clampedTo) {
    throw new ValidationError('History window is outside the available range (the last 5 years up to now)');
  }
  return { from: new Date(clampedFrom), to: new Date(clampedTo) };
}
