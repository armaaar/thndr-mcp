import { MARKET_TIME_ZONE, parseMarketDate } from '../market-data/market-calendar';
import { ValidationError } from '../shared-kernel/errors';

/**
 * Calendar arithmetic on Cairo market days (`YYYY-MM-DD`). Pure: every function takes the instant or day it works
 * from, so tests pin "now".
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day (`YYYY-MM-DD`) of an instant in Cairo. */
export function marketDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const match = DAY.exec(day);
  if (!match) throw new ValidationError(`Invalid calendar day: "${day}"`);
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) };
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const { year, month, date } = parseDay(day);
  return formatUtc(new Date(Date.UTC(year, month - 1, date + days)));
}

/** Moves by whole months, clamping the day to the target month's length (31 Mar − 1 month = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const { year, month, date } = parseDay(day);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date, lastDay));
  return formatUtc(first);
}

export function startOfMonth(day: string): string {
  parseDay(day);
  return `${day.slice(0, 8)}01`;
}

export function startOfYear(day: string): string {
  parseDay(day);
  return `${day.slice(0, 4)}-01-01`;
}

/** Period presets for date-filtered tools (journal, activity). */
export const PERIOD_PRESETS = ['today', '7d', '30d', '90d', 'mtd', 'ytd', '1y'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * First Cairo market day of a preset, counted from `today` (inclusive):
 * `today`; `7d`/`30d`/`90d` = the last N calendar days including today; `mtd` = the 1st of this month; `ytd` =
 * 1 January; `1y` = the last 12 months including today (from the day after the same date last year).
 */
export function presetStartDay(preset: PeriodPreset, today: string): string {
  parseDay(today);
  switch (preset) {
    case 'today':
      return today;
    case '7d':
      return addDays(today, -6);
    case '30d':
      return addDays(today, -29);
    case '90d':
      return addDays(today, -89);
    case 'mtd':
      return startOfMonth(today);
    case 'ytd':
      return startOfYear(today);
    case '1y':
      return addDays(addMonths(today, -12), 1);
  }
}

export function parsePeriodPreset(raw: string): PeriodPreset {
  const value = raw.trim().toLowerCase();
  if (!(PERIOD_PRESETS as readonly string[]).includes(value)) {
    throw new ValidationError(`Unsupported period "${raw}". Use one of: ${PERIOD_PRESETS.join(', ')}`);
  }
  return value as PeriodPreset;
}

/** The instant a preset starts: 00:00 Cairo on its first market day. It runs until now (open end). */
export function presetStart(preset: PeriodPreset, now: Date): Date {
  return parseMarketDate(presetStartDay(preset, marketDay(now)), 'start') as Date;
}
