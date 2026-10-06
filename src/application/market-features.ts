import {
  FEATURE_LABELS,
  MARKET_PROFILES,
  type Market,
  type MarketFeature,
  marketSupports,
  marketsSupporting,
} from '../domain/shared-kernel/market';
import { FeatureDisabledError } from './errors';

/**
 * Fails fast, before calling Thndr, when a market lacks a feature (ADR 0021): the message names the market and the
 * markets that do offer it, so the caller can adjust instead of reading a raw Thndr error.
 */
export function requireMarketFeature(market: Market, feature: MarketFeature): void {
  if (marketSupports(market, feature)) return;
  // Every feature exists in at least one market (the domain table), so there is always somewhere to point to.
  throw new FeatureDisabledError(
    `Thndr does not offer ${FEATURE_LABELS[feature]} for the ${MARKET_PROFILES[market].name} market; it is ` +
      `available for: ${marketsSupporting(feature).join(', ')}.`,
  );
}
