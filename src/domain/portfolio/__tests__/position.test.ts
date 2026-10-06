import { describe, expect, it } from 'vitest';
import { AssetId } from '../../market-data/asset-id';
import { ValidationError } from '../../shared-kernel/errors';
import { Ticker } from '../../shared-kernel/ticker';
import { computeAllocation, createPosition, type PositionInput, positionWeight } from '../position';

const ID = '11111111-2222-3333-4444-555555555555';

function input(overrides: Partial<PositionInput> = {}): PositionInput {
  return {
    instrumentId: AssetId.of(ID),
    ticker: Ticker.of('COMI'),
    assetClass: 'STOCK',
    currency: 'EGP',
    quantity: 100,
    averageCost: null,
    costValue: 8_000,
    marketPrice: 90,
    unrealizedPnl: null,
    unrealizedPnlPercent: null,
    ...overrides,
  };
}

describe('createPosition', () => {
  it('derives average cost, market value and P/L when the broker omits them', () => {
    const p = createPosition(input());
    expect(p.averageCost).toBe(80);
    expect(p.costValue).toBe(8_000);
    expect(p.marketValue).toBe(9_000);
    expect(p.unrealizedPnl).toBe(1_000);
    expect(p.unrealizedPnlPercent).toBe(12.5);
    expect(p.unit).toBeNull();
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('prefers broker-provided figures', () => {
    const p = createPosition(
      input({ averageCost: 79.5, unrealizedPnl: 999, unrealizedPnlPercent: 12, unit: 'grams' }),
    );
    expect(p.averageCost).toBe(79.5);
    expect(p.unrealizedPnl).toBe(999);
    expect(p.unrealizedPnlPercent).toBe(12);
    expect(p.unit).toBe('grams');
  });

  it('derives cost value from average cost', () => {
    expect(createPosition(input({ costValue: null, averageCost: 50 })).costValue).toBe(5_000);
  });

  it('leaves unknowable figures null', () => {
    const p = createPosition(input({ costValue: null, marketPrice: null }));
    expect(p.averageCost).toBeNull();
    expect(p.costValue).toBeNull();
    expect(p.marketValue).toBeNull();
    expect(p.unrealizedPnl).toBeNull();
    expect(p.unrealizedPnlPercent).toBeNull();
  });

  it('handles a zero quantity / zero cost without dividing by zero', () => {
    const p = createPosition(input({ quantity: 0, costValue: 0 }));
    expect(p.averageCost).toBeNull();
    expect(p.unrealizedPnlPercent).toBeNull();
  });

  it('rejects invalid numbers', () => {
    expect(() => createPosition(input({ quantity: -1 }))).toThrow(ValidationError);
    expect(() => createPosition(input({ quantity: Number.NaN }))).toThrow(ValidationError);
    expect(() => createPosition(input({ marketPrice: Number.NaN }))).toThrow(/market price/);
  });
});

describe('computeAllocation', () => {
  const comi = createPosition(input({ quantity: 100, marketPrice: 60 })); // 6000
  const etf = createPosition(input({ ticker: Ticker.of('AZG'), assetClass: 'ETF', marketPrice: 30 })); // 3000
  const fund = createPosition(input({ ticker: Ticker.of('GOLD'), assetClass: 'ETF', marketPrice: 10 })); // 1000
  const unpriced = createPosition(input({ ticker: Ticker.of('X'), instrumentId: null, marketPrice: null }));

  it('weights positions against their total and groups by asset class', () => {
    const a = computeAllocation([etf, unpriced, comi, fund]);
    expect(a.totalMarketValue).toBe(10_000);
    expect(a.basis).toBe(10_000);
    expect(a.positions.map((p) => [p.ticker.value, p.weightPercent])).toEqual([
      ['COMI', 60],
      ['AZG', 30],
      ['GOLD', 10],
      ['X', 0],
    ]);
    expect(a.byAssetClass).toEqual([
      { assetClass: 'STOCK', positions: 2, marketValue: 6_000, weightPercent: 60 },
      { assetClass: 'ETF', positions: 2, marketValue: 4_000, weightPercent: 40 },
    ]);
    expect(a.largestWeightPercent).toBe(60);
  });

  it('uses the broker portfolio value as basis when positive', () => {
    const a = computeAllocation([comi], 12_000);
    expect(a.basis).toBe(12_000);
    expect(a.positions[0]?.weightPercent).toBe(50);
    expect(computeAllocation([comi], 0).basis).toBe(6_000);
    expect(computeAllocation([comi], null).basis).toBe(6_000);
  });

  it('handles an empty portfolio', () => {
    const a = computeAllocation([]);
    expect(a).toMatchObject({ totalMarketValue: 0, basis: 0, positions: [], largestWeightPercent: null });
    expect(computeAllocation([unpriced]).positions[0]?.weightPercent).toBe(0);
  });
});

describe('positionWeight', () => {
  it('returns a 2-decimal percentage, 0 without a usable basis or value', () => {
    expect(positionWeight(1, 3)).toBe(33.33);
    expect(positionWeight(1, 0)).toBe(0);
    expect(positionWeight(null, 10)).toBe(0);
  });
});
