import { describe, expect, it } from 'vitest';
import { dateArg, parseDateArg, utcOffset } from '../../../src/interface/mcp/dates.js';

describe('date arguments', () => {
  it('knows Cairo winter and summer (DST) offsets, and falls back to UTC', () => {
    expect(utcOffset('2026-01-15')).toBe('+02:00');
    expect(utcOffset('2026-07-15')).toBe('+03:00');
    expect(utcOffset('2026-07-15', 'UTC')).toBe('+00:00');
  });

  it('interprets date-only bounds as whole Cairo market days', () => {
    expect(parseDateArg('2026-07-15', 'start')?.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(parseDateArg('2026-07-15', 'end')?.toISOString()).toBe('2026-07-15T20:59:59.999Z');
  });

  it('passes datetimes through and keeps undefined', () => {
    expect(parseDateArg('2026-01-31T10:00:00+02:00', 'end')?.toISOString()).toBe('2026-01-31T08:00:00.000Z');
    expect(parseDateArg(undefined, 'start')).toBeUndefined();
  });

  it('validates input strings', () => {
    expect(dateArg.safeParse('2026-01-31').success).toBe(true);
    expect(dateArg.safeParse('soon').success).toBe(false);
  });
});
