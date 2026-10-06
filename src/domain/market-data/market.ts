import { ValidationError } from '../shared-kernel/errors';

/** Markets Thndr trades on (wire values of ThndrX's `market` query parameter). */
export const MARKETS = ['egypt', 'us'] as const;
export type Market = (typeof MARKETS)[number];
export const DEFAULT_MARKET: Market = 'egypt';

export function parseMarket(raw: string | undefined | null): Market {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MARKET;
  const value = raw.trim().toLowerCase();
  const aliases: Record<string, Market> = { egypt: 'egypt', egx: 'egypt', eg: 'egypt', us: 'us', usa: 'us' };
  const market = aliases[value];
  if (!market) throw new ValidationError(`Unsupported market "${raw}". Use one of: ${MARKETS.join(', ')}`);
  return market;
}

export const ASSET_CLASSES = ['STOCK', 'ETF', 'INDEX', 'FUND', 'UNKNOWN'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export function parseAssetClass(raw: unknown): AssetClass {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return (ASSET_CLASSES as readonly string[]).includes(value) ? (value as AssetClass) : 'UNKNOWN';
}
