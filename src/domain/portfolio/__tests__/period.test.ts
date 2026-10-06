import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  marketDay,
  PERIOD_PRESETS,
  parsePeriodPreset,
  presetStart,
  presetStartDay,
  startOfMonth,
  startOfYear,
} from '../period';

describe('marketDay', () => {
  it('returns the Cairo calendar day of an instant', () => {
    expect(marketDay(new Date('2026-06-01T12:00:00Z'))).toBe('2026-06-01');
    // 21:30 UTC is already the next day in Cairo (UTC+3 in summer, UTC+2 in winter).
    expect(marketDay(new Date('2026-06-01T21:30:00Z'))).toBe('2026-06-02');
    expect(marketDay(new Date('2026-01-01T22:30:00Z'))).toBe('2026-01-02');
    expect(marketDay(new Date('2026-01-01T21:30:00Z'))).toBe('2026-01-01');
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('adds months, clamping the day to the target month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2026-10-05', -6)).toBe('2026-04-05');
    expect(addMonths('2026-10-05', -24)).toBe('2024-10-05');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('finds the start of the month and year', () => {
    expect(startOfMonth('2026-10-06')).toBe('2026-10-01');
    expect(startOfYear('2026-10-06')).toBe('2026-01-01');
  });

  it('rejects malformed days', () => {
    expect(() => addDays('2026-1-1', 1)).toThrow(/Invalid calendar day/);
    expect(() => addMonths('soon', 1)).toThrow(/Invalid calendar day/);
    expect(() => startOfMonth('x')).toThrow(/Invalid calendar day/);
    expect(() => startOfYear('x')).toThrow(/Invalid calendar day/);
    expect(() => presetStartDay('today', 'x')).toThrow(/Invalid calendar day/);
  });
});

describe('period presets', () => {
  it('computes the first market day of each preset (inclusive of today)', () => {
    const today = '2026-06-01';
    const starts = Object.fromEntries(PERIOD_PRESETS.map((p) => [p, presetStartDay(p, today)]));
    expect(starts).toEqual({
      today: '2026-06-01',
      '7d': '2026-05-26',
      '30d': '2026-05-03',
      '90d': '2026-03-04',
      mtd: '2026-06-01',
      ytd: '2026-01-01',
      '1y': '2025-06-02',
    });
  });

  it('starts at 00:00 Cairo on the first day', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(presetStart('today', now).toISOString()).toBe('2026-05-31T21:00:00.000Z');
    expect(presetStart('ytd', now).toISOString()).toBe('2025-12-31T22:00:00.000Z');
  });

  it('parses presets case-insensitively and rejects unknown ones', () => {
    expect(parsePeriodPreset(' MTD ')).toBe('mtd');
    expect(() => parsePeriodPreset('5y')).toThrow(/Unsupported period "5y"/);
  });
});
