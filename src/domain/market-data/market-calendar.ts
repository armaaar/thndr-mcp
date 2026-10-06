import { ValidationError } from '../shared-kernel/errors';

/** EGX trades on Africa/Cairo time (Sunday–Thursday 10:00–14:30). */
export const MARKET_TIME_ZONE = 'Africa/Cairo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UTC offset (e.g. `+03:00`) of `timeZone` on the given calendar day, sampled at noon. On a DST-change day the
 * midnight bound may be off by one hour; EGX is closed at that time, so it has no practical effect.
 */
export function utcOffset(day: string, timeZone = MARKET_TIME_ZONE): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(noon)
    .find((p) => p.type === 'timeZoneName')?.value;
  return name?.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '+00:00';
}

/**
 * Interprets a user-supplied date. Date-only values are **market days**: `start` → 00:00 Cairo, `end` →
 * 23:59:59.999 Cairo, so a range `to: "2026-01-31"` includes the 31st. Datetimes are taken as given.
 */
export function parseMarketDate(value: string | undefined, bound: 'start' | 'end'): Date | undefined {
  if (value === undefined) return undefined;
  const date = DATE_ONLY.test(value)
    ? new Date(`${value}T${bound === 'start' ? '00:00:00.000' : '23:59:59.999'}${utcOffset(value)}`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`Invalid date: "${value}"`);
  return date;
}
