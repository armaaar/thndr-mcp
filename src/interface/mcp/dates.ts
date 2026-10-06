import { z } from 'zod';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const MARKET_TIME_ZONE = 'Africa/Cairo';

/** UTC offset (e.g. `+03:00`) of `timeZone` around the given calendar day. */
export function utcOffset(day: string, timeZone = MARKET_TIME_ZONE): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(noon)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] ?? '+00:00';
}

/**
 * Parses a tool date argument. Date-only values are interpreted as EGX market days (Africa/Cairo):
 * `start` → 00:00 that day, `end` → 23:59:59.999 that day, so `to: "2026-01-31"` includes the 31st.
 */
export function parseDateArg(value: string | undefined, bound: 'start' | 'end'): Date | undefined {
  if (value === undefined) return undefined;
  if (!DATE_ONLY.test(value)) return new Date(value);
  const time = bound === 'start' ? '00:00:00.000' : '23:59:59.999';
  return new Date(`${value}T${time}${utcOffset(value)}`);
}

export const dateArg = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be an ISO-8601 date or datetime')
  .describe('ISO-8601 date (Cairo market day, e.g. 2026-01-31) or datetime (2026-01-31T10:00:00+02:00)');
