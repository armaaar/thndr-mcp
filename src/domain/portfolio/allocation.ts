import { roundTo } from '../shared-kernel/guards';
import type { AssetClass } from '../shared-kernel/market';
import { positionWeight } from './position';

/** Sector bucket of a holding the market snapshot gives no sector for. */
export const UNCLASSIFIED_SECTOR = 'Unclassified';
/** Sector bucket of funds/ETFs without a sector (they are not sector-classified stocks). */
export const FUND_SECTOR = 'Funds (no sector)';
/** Index bucket of holdings that belong to no index. */
export const NO_INDEX = 'Not in any index';

/** A group of holdings and its share of the allocation basis. */
export interface AllocationBucket {
  readonly name: string;
  readonly positions: number;
  readonly marketValue: number;
  /** Share of the basis, in percent (2 decimals). */
  readonly weightPercent: number;
  /** Tickers in the bucket, heaviest first. */
  readonly tickers: readonly string[];
}

/** The sector bucket of a holding: the market snapshot's sector, else a clearly labelled fallback. */
export function sectorBucket(sector: string | null | undefined, assetClass: AssetClass): string {
  const name = typeof sector === 'string' ? sector.trim() : '';
  if (name) return name;
  return assetClass === 'FUND' || assetClass === 'ETF' ? FUND_SECTOR : UNCLASSIFIED_SECTOR;
}

/**
 * Groups weighted holdings into buckets (pure). A holding may fall into several buckets (index membership), in which
 * case the buckets overlap and their weights do not add up to 100%. Heaviest bucket first, then by name.
 */
export function groupAllocation<T extends { readonly ticker: string; readonly marketValue: number }>(
  rows: readonly T[],
  basis: number,
  bucketsOf: (row: T) => readonly string[],
): AllocationBucket[] {
  const groups = new Map<string, { marketValue: number; rows: T[] }>();
  for (const row of rows) {
    for (const name of new Set(bucketsOf(row))) {
      const group = groups.get(name) ?? { marketValue: 0, rows: [] };
      group.marketValue += row.marketValue;
      group.rows.push(row);
      groups.set(name, group);
    }
  }
  return [...groups.entries()]
    .map(([name, group]) =>
      Object.freeze({
        name,
        positions: group.rows.length,
        marketValue: roundTo(group.marketValue, 4),
        weightPercent: positionWeight(group.marketValue, basis),
        tickers: Object.freeze(
          [...group.rows].sort((a, b) => b.marketValue - a.marketValue).map((r) => r.ticker),
        ),
      }),
    )
    .sort((a, b) => b.marketValue - a.marketValue || a.name.localeCompare(b.name));
}
