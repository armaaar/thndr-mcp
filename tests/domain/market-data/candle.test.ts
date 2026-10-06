import { describe, expect, it } from 'vitest';
import {
  CANDLE_RESOLUTIONS,
  createCandle,
  historyWindow,
  MAX_HISTORY_MS,
  RESOLUTION_MS,
} from '../../../src/domain/market-data/candle.js';
import { ValidationError } from '../../../src/domain/shared-kernel/errors.js';

const T = new Date('2026-01-01T10:00:00Z');
const base = { time: T, open: 10, high: 12, low: 9, close: 11, volume: 100 };

describe('resolutions', () => {
  it('has a duration for every resolution', () => {
    for (const r of CANDLE_RESOLUTIONS) expect(RESOLUTION_MS[r]).toBeGreaterThan(0);
    expect(RESOLUTION_MS['1w']).toBe(7 * RESOLUTION_MS['1d']);
  });
});

describe('createCandle', () => {
  it('returns a frozen copy with a defensive date copy', () => {
    const candle = createCandle(base);
    expect(candle).toEqual(base);
    expect(Object.isFrozen(candle)).toBe(true);
    expect(candle.time).not.toBe(T);
  });

  it.each(['open', 'high', 'low', 'close', 'volume'] as const)('rejects a non-finite %s', (field) => {
    expect(() => createCandle({ ...base, [field]: Number.NaN })).toThrow(
      `Candle ${field} must be a finite number`,
    );
  });

  it('rejects invalid dates and inverted ranges', () => {
    expect(() => createCandle({ ...base, time: new Date('nope') })).toThrow(
      'Candle time must be a valid date',
    );
    expect(() => createCandle({ ...base, high: 8 })).toThrow(ValidationError);
    expect(() => createCandle({ ...base, high: 8 })).toThrow('Candle high must be >= low');
  });
});

describe('historyWindow', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('passes a valid window through', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-05T00:00:00Z');
    expect(historyWindow(from, to, now)).toEqual({ from, to });
  });

  it('clamps to the last 5 years and to now', () => {
    const from = new Date(now.getTime() - MAX_HISTORY_MS - 86_400_000);
    const to = new Date(now.getTime() + 86_400_000);
    expect(historyWindow(from, to, now)).toEqual({ from: new Date(now.getTime() - MAX_HISTORY_MS), to: now });
  });

  it('rejects invalid or inverted windows', () => {
    expect(() => historyWindow(new Date('x'), now, now)).toThrow('History window dates must be valid');
    expect(() => historyWindow(now, new Date('x'), now)).toThrow('History window dates must be valid');
    expect(() => historyWindow(now, now, now)).toThrow('History "from" must be before "to"');
  });

  it('rejects windows entirely outside the available range', () => {
    const future = new Date(now.getTime() + 1000);
    expect(() => historyWindow(future, new Date(future.getTime() + 1000), now)).toThrow(
      'History window is outside the available range',
    );
    const ancient = new Date(now.getTime() - MAX_HISTORY_MS - 10_000);
    expect(() => historyWindow(ancient, new Date(ancient.getTime() + 1000), now)).toThrow(ValidationError);
  });
});
