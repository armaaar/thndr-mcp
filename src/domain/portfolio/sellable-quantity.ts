import { roundTo } from '../shared-kernel/guards';

export const CUSTODIANS = ['AUB', 'THN', 'OTHER'] as const;
export type Custodian = (typeof CUSTODIANS)[number];

/** Held vs. blocked (by open sell orders) quantity of one settlement bucket. */
export interface QuantityBucket {
  readonly total: number;
  readonly blocked: number;
  /** ThndrX: `qty_X - qty_blocked_X`, never below zero. */
  readonly available: number;
}

export function quantityBucket(total: number | null, blocked: number | null): QuantityBucket {
  const t = total !== null && Number.isFinite(total) ? total : 0;
  const b = blocked !== null && Number.isFinite(blocked) ? blocked : 0;
  return Object.freeze({ total: t, blocked: b, available: Math.max(roundTo(t - b, 6), 0) });
}

/** How much of a holding can be sold, per settlement cycle (EGX settles T+0, T+1 and T+2 "settled"). */
export interface SellableQuantity {
  readonly all: QuantityBucket;
  readonly t0: QuantityBucket;
  readonly t1: QuantityBucket;
  readonly settled: QuantityBucket;
  /** Shares that cannot be sold at all (e.g. pledged or under corporate action). */
  readonly unsalable: QuantityBucket;
  /** ThndrX picks `AUB` when settled shares sit with AUB, else `THN`; null when unknown. */
  readonly custodian: Custodian | null;
}
