import { z } from 'zod';
import { ALERT_DIRECTIONS, ALERT_FREQUENCIES } from '../../domain/engagement/price-alert';
import { WATCHLIST_NAME_MAX_LENGTH } from '../../domain/engagement/watchlist';
import { symbolInput } from '../inputs';
import { MAX_SYMBOLS_PER_CALL } from './constants';

/** Reusable input fields of the Engagement use-case contracts. */
export const idInput = z.string().min(1);
export const symbolsInput = z.array(symbolInput).max(MAX_SYMBOLS_PER_CALL);
export const watchlistNameInput = z.string().min(1).max(WATCHLIST_NAME_MAX_LENGTH);
export const priceInput = z.number().positive().describe('Trigger price in the instrument currency');
export const directionInput = z
  .enum(ALERT_DIRECTIONS)
  .optional()
  .describe('UP or DOWN; derived from the current price if omitted');
export const frequencyInput = z
  .enum(ALERT_FREQUENCIES)
  .optional()
  .describe('ONE_TIME (default) or RECURRING');
export const pageCountInput = z.number().int().min(1).max(100).default(20);
