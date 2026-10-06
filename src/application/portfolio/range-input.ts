import { z } from 'zod';
import { parseMarketDate } from '../../domain/market-data/market-calendar';
import { type DateRange, journalRange } from '../../domain/portfolio/journal';
import { PERIOD_PRESETS, parsePeriodPreset, presetStart } from '../../domain/portfolio/period';
import { ValidationError } from '../../domain/shared-kernel/errors';
import { dateInput } from '../inputs';
import type { Clock } from '../ports/clock';

/** `period` preset field shared by the date-filtered Portfolio queries. */
export const periodInput = z
  .enum(PERIOD_PRESETS)
  .optional()
  .describe(
    'Preset range in Cairo market days, up to now: today, 7d/30d/90d (last N days incl. today), mtd, ytd, ' +
      '1y (last 12 months). Do not combine with from/to.',
  );

/** Input fields of a date range: explicit `from`/`to` or a `period` preset (mutually exclusive). */
export const rangeInput = {
  from: dateInput.optional(),
  to: dateInput.optional(),
  period: periodInput,
};

export interface RangeParams {
  from?: string;
  to?: string;
  period?: string;
}

/**
 * Builds a validated range from `from`/`to` (date-only bounds are Cairo market days) or a `period` preset (from 00:00
 * Cairo on its first day, open-ended). Giving both is a validation error.
 */
export function resolveRange(params: RangeParams, clock: Clock, label = 'Journal'): DateRange {
  const now = clock.now();
  if (params.period !== undefined && params.period !== '') {
    if (params.from !== undefined || params.to !== undefined) {
      throw new ValidationError('Use either "period" or "from"/"to", not both');
    }
    return journalRange(presetStart(parsePeriodPreset(params.period), now), undefined, now, label);
  }
  return journalRange(parseMarketDate(params.from, 'start'), parseMarketDate(params.to, 'end'), now, label);
}
