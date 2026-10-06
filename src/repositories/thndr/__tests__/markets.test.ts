import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_PROVIDER,
  accountMarket,
  instrumentMarket,
  marketFromWire,
  statusExchange,
} from '../markets';

describe('Thndr market wire codes', () => {
  it('uses abudhabi for UAE accounts and adsm for UAE instruments', () => {
    expect(['egypt', 'us', 'uae', 'simulator'].map((m) => accountMarket(m as never))).toEqual([
      'egypt',
      'us',
      'abudhabi',
      'simulator',
    ]);
    expect(['egypt', 'us', 'uae', 'simulator'].map((m) => instrumentMarket(m as never))).toEqual([
      'egypt',
      'us',
      'adsm',
      'simulator',
    ]);
  });

  it('names the activity provider per market, with none for the simulator', () => {
    expect(ACTIVITY_PROVIDER).toEqual({ egypt: 'EGID', us: 'ALPACA', uae: 'ADX_UAE', simulator: null });
  });

  it('sends the market_exchange Thndr needs for market status', () => {
    expect(statusExchange('egypt')).toBe('NOPL');
    expect(statusExchange('egypt', 'OOTC')).toBe('OOTC');
    expect(statusExchange('egypt', '')).toBe('NOPL');
    expect(statusExchange('us', 'stocks')).toBe('NOPL');
    expect(statusExchange('uae', 'R')).toBe('adsm');
    expect(statusExchange('simulator')).toBe('NOPL');
  });

  it('reads every wire code back, and nothing else', () => {
    expect(marketFromWire('egypt')).toBe('egypt');
    expect(marketFromWire(' US ')).toBe('us');
    expect(marketFromWire('adsm')).toBe('uae');
    expect(marketFromWire('abudhabi')).toBe('uae');
    expect(marketFromWire('simulator')).toBe('simulator');
    expect(marketFromWire('boom_sim')).toBe('simulator');
    expect(marketFromWire('tdwl')).toBeNull();
    expect(marketFromWire(3)).toBeNull();
    expect(marketFromWire(undefined)).toBeNull();
  });
});
