import { describe, expect, it } from 'vitest';
import { FUND_SECTOR, groupAllocation, NO_INDEX, sectorBucket, UNCLASSIFIED_SECTOR } from '../allocation';

describe('sectorBucket', () => {
  it('uses the sector, else labels funds and unclassified holdings explicitly', () => {
    expect(sectorBucket(' Banks ', 'STOCK')).toBe('Banks');
    expect(sectorBucket(null, 'FUND')).toBe(FUND_SECTOR);
    expect(sectorBucket('', 'ETF')).toBe(FUND_SECTOR);
    expect(sectorBucket(undefined, 'STOCK')).toBe(UNCLASSIFIED_SECTOR);
    expect(sectorBucket(null, 'UNKNOWN')).toBe(UNCLASSIFIED_SECTOR);
  });
});

describe('groupAllocation', () => {
  const rows = [
    { ticker: 'COMI', marketValue: 600, keys: ['EGX30', 'SHARIAH'] },
    { ticker: 'HRHO', marketValue: 300, keys: ['EGX30', 'EGX30'] },
    { ticker: 'BMM', marketValue: 100, keys: [NO_INDEX] },
  ];

  it('groups weights, heaviest first, letting buckets overlap', () => {
    const buckets = groupAllocation(rows, 1_000, (r) => r.keys);
    expect(buckets).toEqual([
      { name: 'EGX30', positions: 2, marketValue: 900, weightPercent: 90, tickers: ['COMI', 'HRHO'] },
      { name: 'SHARIAH', positions: 1, marketValue: 600, weightPercent: 60, tickers: ['COMI'] },
      { name: NO_INDEX, positions: 1, marketValue: 100, weightPercent: 10, tickers: ['BMM'] },
    ]);
    expect(Object.isFrozen(buckets[0])).toBe(true);
    expect(Object.isFrozen(buckets[0]?.tickers)).toBe(true);
  });

  it('orders equal buckets by name, lists tickers heaviest first and tolerates a zero basis', () => {
    const buckets = groupAllocation(
      [
        { ticker: 'A', marketValue: 1 },
        { ticker: 'B', marketValue: 2 },
        { ticker: 'C', marketValue: 3 },
      ],
      0,
      (r) => (r.ticker === 'C' ? ['y'] : ['x']),
    );
    expect(buckets.map((b) => [b.name, b.weightPercent, b.tickers])).toEqual([
      ['x', 0, ['B', 'A']],
      ['y', 0, ['C']],
    ]);
    expect(groupAllocation([], 100, () => ['x'])).toEqual([]);
  });
});
