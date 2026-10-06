import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../shared-kernel/errors';
import { createOverallTradingStats, journalRange, perUnitOfLoss } from '../journal';

const now = new Date('2026-06-01T00:00:00Z');

describe('perUnitOfLoss', () => {
  it('divides by the magnitude of the average loss', () => {
    expect(perUnitOfLoss(300, -150)).toBe(2);
    expect(perUnitOfLoss(300, 150)).toBe(2);
    expect(perUnitOfLoss(null, 150)).toBeNull();
    expect(perUnitOfLoss(300, null)).toBeNull();
    expect(perUnitOfLoss(300, 0)).toBeNull();
  });
});

describe('createOverallTradingStats', () => {
  it('derives risk/reward and expectancy in R', () => {
    const stats = createOverallTradingStats({
      totalReturn: 1_000,
      profitFactor: 1.8,
      expectancyPerTrade: 50,
      winRatePercent: 55,
      averageWin: 400,
      averageLoss: -200,
      numberOfTrades: 20,
      averagePositionSize: 10_000,
      averageDurationDays: 7,
    });
    expect(stats.riskRewardRatio).toBe(2);
    expect(stats.expectancyR).toBe(0.25);
    expect(Object.isFrozen(stats)).toBe(true);
  });
});

describe('journalRange', () => {
  it('accepts open-ended ranges', () => {
    expect(journalRange(undefined, undefined, now)).toEqual({});
    const from = new Date('2026-01-01T00:00:00Z');
    expect(journalRange(from, undefined, now)).toEqual({ from });
    const to = new Date('2026-02-01T00:00:00Z');
    expect(journalRange(from, to, now)).toEqual({ from, to });
    expect(journalRange(undefined, to, now)).toEqual({ to });
  });

  it('rejects invalid ranges', () => {
    expect(() => journalRange(new Date('nope'), undefined, now)).toThrow(ValidationError);
    expect(() => journalRange(new Date('2026-02-01'), new Date('2026-01-01'), now)).toThrow(/before/);
    expect(() => journalRange(new Date('2027-01-01'), undefined, now)).toThrow(/future/);
  });
});
