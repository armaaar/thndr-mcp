import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET, parseAssetClass, parseMarket } from '../../../src/domain/market-data/market.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';

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
  ])('accepts alias %s', (raw, expected) => {
    expect(parseMarket(raw)).toBe(expected);
  });

  it('rejects unsupported markets', () => {
    expect(() => parseMarket('adsm')).toThrow(ValidationError);
    expect(() => parseMarket('adsm')).toThrow('Unsupported market "adsm". Use one of: egypt, us');
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
