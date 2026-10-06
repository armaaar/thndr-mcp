import { describe, expect, it, vi } from 'vitest';
import { parseMarketDate, utcOffset } from '../../../src/domain/market-data/market-calendar';
import { ValidationError } from '../../../src/domain/shared-kernel/errors';

describe('date arguments', () => {
  it('knows Cairo winter and summer (DST) offsets, and falls back to UTC', () => {
    expect(utcOffset('2026-01-15')).toBe('+02:00');
    expect(utcOffset('2026-07-15')).toBe('+03:00');
    expect(utcOffset('2026-07-15', 'UTC')).toBe('+00:00');
  });

  it('falls back to UTC when the runtime reports no time-zone name', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([]);
    expect(utcOffset('2026-07-15')).toBe('+00:00');
  });

  it('interprets date-only bounds as whole Cairo market days', () => {
    expect(parseMarketDate('2026-07-15', 'start')?.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(parseMarketDate('2026-07-15', 'end')?.toISOString()).toBe('2026-07-15T20:59:59.999Z');
  });

  it('passes datetimes through and keeps undefined', () => {
    expect(parseMarketDate('2026-01-31T10:00:00+02:00', 'end')?.toISOString()).toBe(
      '2026-01-31T08:00:00.000Z',
    );
    expect(parseMarketDate(undefined, 'start')).toBeUndefined();
  });

  it('rejects unparsable dates', () => {
    expect(() => parseMarketDate('soon', 'start')).toThrow(ValidationError);
  });
});
