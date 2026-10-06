import { ValidationError } from './errors';
import type { Currency } from './money';

/**
 * Markets Thndr serves (ADR 0021). `uae` is the Abu Dhabi Securities Exchange; `simulator` is Thndr's paper-trading
 * account. Thndr's own wire codes (`adsm`/`abudhabi` for the UAE) live in the Thndr adapters.
 */
export const MARKETS = ['egypt', 'us', 'uae', 'simulator'] as const;
export type Market = (typeof MARKETS)[number];
export const DEFAULT_MARKET: Market = 'egypt';

export interface MarketProfile {
  readonly market: Market;
  readonly name: string;
  /** Currency of the market's cash account and quotes. */
  readonly currency: Currency;
  readonly timeZone: string;
}

export const MARKET_PROFILES: Readonly<Record<Market, MarketProfile>> = Object.freeze({
  egypt: Object.freeze({
    market: 'egypt',
    name: 'Egypt — Egyptian Exchange (EGX)',
    currency: 'EGP',
    timeZone: 'Africa/Cairo',
  }),
  us: Object.freeze({
    market: 'us',
    name: 'United States — NYSE, Nasdaq and ETFs (through Alpaca)',
    currency: 'USD',
    timeZone: 'America/New_York',
  }),
  uae: Object.freeze({
    market: 'uae',
    name: 'UAE — Abu Dhabi Securities Exchange (ADX)',
    currency: 'AED',
    timeZone: 'Asia/Dubai',
  }),
  simulator: Object.freeze({
    market: 'simulator',
    name: 'Simulator — Thndr paper-trading account',
    currency: 'EGP',
    timeZone: 'Africa/Cairo',
  }),
});

export function parseMarket(raw: string | undefined | null): Market {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MARKET;
  const value = raw.trim().toLowerCase();
  if (!(MARKETS as readonly string[]).includes(value)) {
    throw new ValidationError(`Unsupported market "${raw}". Use one of: ${MARKETS.join(', ')}`);
  }
  return value as Market;
}

/**
 * What Thndr offers per market (ADR 0021; verified with read-only calls on 2026-10-06). Account features of the
 * simulator are those of a paper account; its instruments are Egypt's and the US's, so market data follows the
 * instrument.
 */
export const MARKET_FEATURES = [
  'marketSnapshot',
  'candles',
  'orderBook',
  'financials',
  'indices',
  'movers',
  'trending',
  'tags',
  'marketStatus',
  'account',
  'activity',
  'returns',
  'journal',
  'watchlists',
  'priceAlerts',
  'savings',
] as const;
export type MarketFeature = (typeof MARKET_FEATURES)[number];

export const FEATURE_LABELS: Readonly<Record<MarketFeature, string>> = {
  marketSnapshot: 'the whole-market snapshot (screens, index members, sector peers)',
  candles: 'OHLC candles (other markets have closing prices only)',
  orderBook: 'the order book and the trades book',
  financials: 'company financials',
  indices: 'indices with their members',
  movers: 'top gainers and losers',
  trending: 'trending instruments',
  tags: 'tags (themes) and their instruments',
  marketStatus: 'market open/closed status and session hours',
  account: 'the cash account, positions and orders',
  activity: 'the account activity ledger',
  returns: 'returns and performance history',
  journal: 'the trading journal',
  watchlists: 'watchlists',
  priceAlerts: 'price alerts',
  savings: 'savings (Clouds)',
};

const SUPPORT: Readonly<Record<MarketFeature, readonly Market[]>> = {
  marketSnapshot: ['egypt'],
  candles: ['egypt'],
  orderBook: ['egypt'],
  financials: ['egypt'],
  indices: ['egypt'],
  movers: ['egypt', 'us'],
  trending: ['egypt', 'us', 'uae'],
  tags: ['egypt', 'us'],
  marketStatus: ['egypt', 'us', 'uae'],
  account: ['egypt', 'us', 'uae', 'simulator'],
  activity: ['egypt', 'us', 'uae'],
  returns: ['egypt', 'us', 'uae'],
  journal: ['egypt'],
  watchlists: ['egypt', 'us', 'uae'],
  priceAlerts: ['egypt', 'us'],
  savings: ['egypt'],
};

export function marketSupports(market: Market, feature: MarketFeature): boolean {
  return SUPPORT[feature].includes(market);
}

/** Markets offering a feature, in {@link MARKETS} order. */
export function marketsSupporting(feature: MarketFeature): Market[] {
  return MARKETS.filter((market) => marketSupports(market, feature));
}

export const ASSET_CLASSES = ['STOCK', 'ETF', 'INDEX', 'FUND', 'UNKNOWN'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export function parseAssetClass(raw: unknown): AssetClass {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return (ASSET_CLASSES as readonly string[]).includes(value) ? (value as AssetClass) : 'UNKNOWN';
}
