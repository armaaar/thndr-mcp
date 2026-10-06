import { describe, expect, it } from 'vitest';
import { relativeVolume } from '../../../src/domain/market-data/instrument.js';

describe('relativeVolume', () => {
  it('is volume as a percentage of the 30-day average', () => {
    expect(relativeVolume({ volume: 1500, averageVolume30d: 1000 })).toBe(150);
    expect(relativeVolume({ volume: 0, averageVolume30d: 1000 })).toBe(0);
  });

  it('is null without volume or a usable average', () => {
    expect(relativeVolume({ volume: null, averageVolume30d: 1000 })).toBeNull();
    expect(relativeVolume({ volume: 100, averageVolume30d: null })).toBeNull();
    expect(relativeVolume({ volume: 100, averageVolume30d: 0 })).toBeNull();
  });
});
