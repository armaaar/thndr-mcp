import type { AssetId } from '../market-data/asset-id.js';
import { ValidationError } from '../shared/errors.js';
import { assertPositive } from '../shared/guards.js';
import type { Ticker } from '../shared/ticker.js';

/** Which way the price must cross the target for the alert to fire. */
export const ALERT_DIRECTIONS = ['UP', 'DOWN'] as const;
export type AlertDirection = (typeof ALERT_DIRECTIONS)[number];

/** `ONE_TIME` alerts are consumed when they fire; `RECURRING` alerts re-arm. */
export const ALERT_FREQUENCIES = ['ONE_TIME', 'RECURRING'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];
export const DEFAULT_ALERT_FREQUENCY: AlertFrequency = 'ONE_TIME';

/** A price alert on one instrument (aggregate root). Unknown upstream values are `null`. */
export interface PriceAlert {
  readonly id: string;
  readonly instrumentId: AssetId;
  readonly ticker: Ticker | null;
  readonly targetPrice: number;
  readonly direction: AlertDirection | null;
  readonly frequency: AlertFrequency | null;
  readonly createdAt: Date | null;
}

export function createPriceAlert(input: {
  id: string;
  instrumentId: AssetId;
  ticker?: Ticker | null;
  targetPrice: number;
  direction?: AlertDirection | null;
  frequency?: AlertFrequency | null;
  createdAt?: Date | null;
}): PriceAlert {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id.length === 0) throw new ValidationError('Price alert id must not be empty');
  assertPositive(input.targetPrice, 'Alert target price');
  const createdAt = input.createdAt ?? null;
  return Object.freeze({
    id,
    instrumentId: input.instrumentId,
    ticker: input.ticker ?? null,
    targetPrice: input.targetPrice,
    direction: input.direction ?? null,
    frequency: input.frequency ?? null,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? new Date(createdAt.getTime()) : null,
  });
}

/**
 * ThndrX's rule (docs/api/market-data.md §5.2): a target below the current price is a `DOWN` alert, anything
 * else (including equal) is `UP`.
 */
export function deriveAlertDirection(targetPrice: number, currentPrice: number): AlertDirection {
  assertPositive(targetPrice, 'Alert target price');
  assertPositive(currentPrice, 'Current price');
  return targetPrice < currentPrice ? 'DOWN' : 'UP';
}

/** Case-insensitive; accepts `above`/`below` as aliases of `UP`/`DOWN`. Returns null when absent. */
export function parseAlertDirection(raw: string | undefined | null): AlertDirection | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const value = raw.trim().toUpperCase();
  const aliases: Record<string, AlertDirection> = { UP: 'UP', ABOVE: 'UP', DOWN: 'DOWN', BELOW: 'DOWN' };
  const direction = aliases[value];
  if (!direction) throw new ValidationError(`Invalid alert direction "${raw}". Use UP or DOWN`);
  return direction;
}

/** Case-insensitive; accepts `one-time`/`once`/`recurring`/`repeat`. Returns null when absent. */
export function parseAlertFrequency(raw: string | undefined | null): AlertFrequency | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const aliases: Record<string, AlertFrequency> = {
    ONE_TIME: 'ONE_TIME',
    ONCE: 'ONE_TIME',
    RECURRING: 'RECURRING',
    REPEAT: 'RECURRING',
  };
  const frequency = aliases[value];
  if (!frequency) throw new ValidationError(`Invalid alert frequency "${raw}". Use ONE_TIME or RECURRING`);
  return frequency;
}
