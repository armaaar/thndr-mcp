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
  const offered = marketsSupporting(feature);
  throw new FeatureDisabledError(
    `Thndr does not offer ${FEATURE_LABELS[feature]} for the ${MARKET_PROFILES[market].name} market` +
      (offered.length > 0 ? `; it is available for: ${offered.join(', ')}.` : '.'),
  );
}
