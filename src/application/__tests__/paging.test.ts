import { describe, expect, it } from 'vitest';
import { clamp } from '../paging';

describe('clamp', () => {
  it('truncates and bounds values, falling back when missing or not finite', () => {
    expect(clamp(5.9, 1, 1, 10)).toBe(5);
    expect(clamp(0, 1, 1, 10)).toBe(1);
    expect(clamp(99, 1, 1, 10)).toBe(10);
    expect(clamp(undefined, 3, 1, 10)).toBe(3);
    expect(clamp(Number.NaN, 4, 1, 10)).toBe(4);
  });
});
