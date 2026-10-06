import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import {
  DEFAULT_MARKET,
  MARKET_PROFILES,
  MARKETS,
  marketSupports,
  marketsSupporting,
  parseAssetClass,
  parseMarket,
} from '../market';

describe('parseMarket', () => {
  it('defaults to egypt when absent', () => {
    expect(DEFAULT_MARKET).toBe('egypt');
    expect(parseMarket(undefined)).toBe('egypt');
    expect(parseMarket(null)).toBe('egypt');
    expect(parseMarket('')).toBe('egypt');
  });

  it.each([
    ['egypt', 'egypt'],
    [' EGX ', 'egypt'],
    ['eg', 'egypt'],
    ['US', 'us'],
    ['usa', 'us'],
    ['Nasdaq', 'us'],
    ['nyse', 'us'],
    ['uae', 'uae'],
    ['ADX', 'uae'],
    ['abudhabi', 'uae'],
    ['Abu Dhabi', 'uae'],
    ['adsm', 'uae'],
    ['simulator', 'simulator'],
    ['sim', 'simulator'],
  ])('accepts alias %s', (raw, expected) => {
    expect(parseMarket(raw)).toBe(expected);
  });

  it('rejects unsupported markets', () => {
    expect(() => parseMarket('tdwl')).toThrow(ValidationError);
    expect(() => parseMarket('tdwl')).toThrow(
      'Unsupported market "tdwl". Use one of: egypt, us, uae, simulator',
    );
  });
});

describe('parseAssetClass', () => {
  it('maps known classes case-insensitively', () => {
    expect(parseAssetClass('stock')).toBe('STOCK');
    expect(parseAssetClass('ETF')).toBe('ETF');
    expect(parseAssetClass('INDEX')).toBe('INDEX');
    expect(parseAssetClass('FUND')).toBe('FUND');
  });

  it('falls back to UNKNOWN', () => {
    expect(parseAssetClass('BOND')).toBe('UNKNOWN');
    expect(parseAssetClass(undefined)).toBe('UNKNOWN');
    expect(parseAssetClass(3)).toBe('UNKNOWN');
  });
});

describe('market profiles and features', () => {
  it('gives each market its currency and time zone', () => {
    expect(MARKETS.map((m) => [m, MARKET_PROFILES[m].currency, MARKET_PROFILES[m].timeZone])).toEqual([
      ['egypt', 'EGP', 'Africa/Cairo'],
      ['us', 'USD', 'America/New_York'],
      ['uae', 'AED', 'Asia/Dubai'],
      ['simulator', 'EGP', 'Africa/Cairo'],
    ]);
    expect(Object.isFrozen(MARKET_PROFILES.uae)).toBe(true);
  });

  it('knows what Thndr offers in each market', () => {
    expect(marketsSupporting('marketSnapshot')).toEqual(['egypt']);
    expect(marketsSupporting('orderBook')).toEqual(['egypt']);
    expect(marketsSupporting('movers')).toEqual(['egypt', 'us']);
    expect(marketsSupporting('trending')).toEqual(['egypt', 'us', 'uae']);
    expect(marketsSupporting('tags')).toEqual(['egypt', 'us']);
    expect(marketsSupporting('priceAlerts')).toEqual(['egypt', 'us']);
    expect(marketsSupporting('marketStatus')).toEqual(['egypt', 'us', 'uae']);
    expect(marketsSupporting('account')).toEqual(['egypt', 'us', 'uae', 'simulator']);
    expect(marketSupports('uae', 'watchlists')).toBe(true);
    expect(marketSupports('simulator', 'activity')).toBe(false);
    expect(marketSupports('us', 'savings')).toBe(false);
  });
});
