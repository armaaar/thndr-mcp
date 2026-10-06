import { describe, expect, it } from 'vitest';
import { quantityBucket } from '../../../src/domain/portfolio/sellable-quantity.js';

describe('quantityBucket', () => {
  it('computes available quantity, never negative', () => {
    expect(quantityBucket(100, 30)).toEqual({ total: 100, blocked: 30, available: 70 });
    expect(quantityBucket(10, 30).available).toBe(0);
    expect(quantityBucket(null, null)).toEqual({ total: 0, blocked: 0, available: 0 });
    expect(quantityBucket(Number.NaN, 1).total).toBe(0);
    expect(Object.isFrozen(quantityBucket(1, 0))).toBe(true);
  });
});
