import { describe, expect, it } from 'vitest';
import { FeatureDisabledError } from '../errors';
import { requireMarketFeature } from '../market-features';

describe('requireMarketFeature', () => {
  it('passes for a market that offers the feature', () => {
    expect(() => requireMarketFeature('egypt', 'orderBook')).not.toThrow();
    expect(() => requireMarketFeature('uae', 'account')).not.toThrow();
  });

  it('names the market and where the feature is available', () => {
    expect(() => requireMarketFeature('us', 'orderBook')).toThrow(FeatureDisabledError);
    expect(() => requireMarketFeature('us', 'orderBook')).toThrow(
      'Thndr does not offer the order book and the trades book for the United States — NYSE, Nasdaq and ETFs (through Alpaca) market; it is available for: egypt.',
    );
    expect(() => requireMarketFeature('uae', 'priceAlerts')).toThrow('available for: egypt, us.');
  });
});
