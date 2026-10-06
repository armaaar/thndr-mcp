import type { AssetId } from '../shared-kernel/asset-id';
import { ValidationError } from '../shared-kernel/errors';
import { assertFiniteNumber, roundTo } from '../shared-kernel/guards';
import type { AssetClass } from '../shared-kernel/market';
import type { Currency } from '../shared-kernel/money';
import type { Ticker } from '../shared-kernel/ticker';

export interface PositionInput {
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly assetClass: AssetClass;
  readonly currency: Currency;
  readonly quantity: number;
  /** Average entry price per unit, when the broker sends it (wire `avg_cost`). */
  readonly averageCost: number | null;
  /** Total cost of the position (wire `cost_value`). */
  readonly costValue: number | null;
  readonly marketPrice: number | null;
  readonly unrealizedPnl: number | null;
  readonly unrealizedPnlPercent: number | null;
  /** Quantity unit when not shares (e.g. `grams` for gold funds). */
  readonly unit?: string | null;
}

/** A holding in the account. Derived figures fall back to ThndrX's own formulas when the broker omits them. */
export interface Position {
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly assetClass: AssetClass;
  readonly currency: Currency;
  readonly quantity: number;
  readonly unit: string | null;
  /** `avg_cost`, else `cost_value / qty`. */
  readonly averageCost: number | null;
  readonly costValue: number | null;
  readonly marketPrice: number | null;
  /** `qty * market_price`. */
  readonly marketValue: number | null;
  readonly unrealizedPnl: number | null;
  readonly unrealizedPnlPercent: number | null;
}

function optionalFinite(value: number | null, label: string): number | null {
  if (value === null) return null;
  assertFiniteNumber(value, label);
  return value;
}

export function createPosition(input: PositionInput): Position {
  assertFiniteNumber(input.quantity, 'Position quantity');
  if (input.quantity < 0) throw new ValidationError('Position quantity must not be negative');
  const quantity = input.quantity;
  const rawAverage = optionalFinite(input.averageCost, 'Position average cost');
  const rawCost = optionalFinite(input.costValue, 'Position cost value');
  const marketPrice = optionalFinite(input.marketPrice, 'Position market price');
  const rawPnl = optionalFinite(input.unrealizedPnl, 'Position unrealized P/L');
  const rawPnlPercent = optionalFinite(input.unrealizedPnlPercent, 'Position unrealized P/L percent');

  const averageCost =
    rawAverage ?? (rawCost !== null && quantity > 0 ? roundTo(rawCost / quantity, 6) : null);
  const costValue = rawCost ?? (averageCost !== null ? roundTo(averageCost * quantity, 4) : null);
  const marketValue = marketPrice !== null ? roundTo(quantity * marketPrice, 4) : null;
  const unrealizedPnl =
    rawPnl ?? (marketValue !== null && costValue !== null ? roundTo(marketValue - costValue, 4) : null);
  const unrealizedPnlPercent =
    rawPnlPercent ??
    (unrealizedPnl !== null && costValue !== null && costValue > 0
      ? roundTo((unrealizedPnl / costValue) * 100, 4)
      : null);

  return Object.freeze({
    instrumentId: input.instrumentId,
    ticker: input.ticker,
    assetClass: input.assetClass,
    currency: input.currency,
    quantity,
    unit: input.unit ?? null,
    averageCost,
    costValue,
    marketPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent,
  });
}

export interface PositionWeight {
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly assetClass: AssetClass;
  readonly marketValue: number;
  /** Share of the basis, in percent (2 decimals). */
  readonly weightPercent: number;
}

export interface AssetClassWeight {
  readonly assetClass: AssetClass;
  readonly positions: number;
  readonly marketValue: number;
  readonly weightPercent: number;
}

export interface AllocationSummary {
  /** Sum of the positions' market values. */
  readonly totalMarketValue: number;
  /** Denominator of the weights: the portfolio value when given and positive, else `totalMarketValue`. */
  readonly basis: number;
  /** Heaviest first. */
  readonly positions: readonly PositionWeight[];
  /** Heaviest first. */
  readonly byAssetClass: readonly AssetClassWeight[];
  readonly largestWeightPercent: number | null;
}

/** Percentage (2 decimals) of `value` in `basis`; 0 when the basis is not positive. */
export function positionWeight(value: number | null, basis: number): number {
  return basis > 0 && value !== null ? roundTo((value / basis) * 100, 2) : 0;
}

/**
 * Weight of each position in the portfolio value (pure). Positions without a market price count as zero.
 * Weights are relative to `portfolioValue` when provided (so they reflect the broker's own total), otherwise to
 * the sum of the positions' market values.
 */
export function computeAllocation(
  positions: readonly Position[],
  portfolioValue?: number | null,
): AllocationSummary {
  const totalMarketValue = roundTo(
    positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0),
    4,
  );
  const basis =
    typeof portfolioValue === 'number' && Number.isFinite(portfolioValue) && portfolioValue > 0
      ? portfolioValue
      : totalMarketValue;
  const weight = (value: number) => positionWeight(value, basis);

  const weights: PositionWeight[] = positions
    .map((p) =>
      Object.freeze({
        instrumentId: p.instrumentId,
        ticker: p.ticker,
        assetClass: p.assetClass,
        marketValue: p.marketValue ?? 0,
        weightPercent: weight(p.marketValue ?? 0),
      }),
    )
    .sort((a, b) => b.marketValue - a.marketValue);

  const groups = new Map<AssetClass, { positions: number; marketValue: number }>();
  for (const p of weights) {
    const group = groups.get(p.assetClass) ?? { positions: 0, marketValue: 0 };
    group.positions += 1;
    group.marketValue += p.marketValue;
    groups.set(p.assetClass, group);
  }
  const byAssetClass: AssetClassWeight[] = [...groups.entries()]
    .map(([assetClass, g]) =>
      Object.freeze({
        assetClass,
        positions: g.positions,
        marketValue: roundTo(g.marketValue, 4),
        weightPercent: weight(g.marketValue),
      }),
    )
    .sort((a, b) => b.marketValue - a.marketValue);

  return Object.freeze({
    totalMarketValue,
    basis,
    positions: Object.freeze(weights),
    byAssetClass: Object.freeze(byAssetClass),
    largestWeightPercent: weights[0]?.weightPercent ?? null,
  });
}
