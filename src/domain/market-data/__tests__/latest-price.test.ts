import { describe, expect, it } from 'vitest';
import { aLatestPrice, aUsInstrument } from '../../../__tests__/support/fake-market-data';
import { quoteFromLatestPrice } from '../latest-price';

describe('quoteFromLatestPrice', () => {
  it('builds a thin quote: change from the previous close, listing fields from the instrument, the rest null', () => {
    const quote = quoteFromLatestPrice(
      aUsInstrument({ suspended: true }),
      aLatestPrice({ kind: 'trade', bid: 1, ask: 2 }),
    );
    expect(Object.isFrozen(quote)).toBe(true);
    expect(quote).toMatchObject({
      name: 'NVIDIA Corporation Common Stock',
      sector: 'Semiconductors & Semiconductor Equipment',
      board: 'stocks',
      currency: 'USD',
      last: 240.1,
      open: 242.1,
      previousClose: 238.9,
      change: 1.2,
      changePercent: 0.5023,
      bid: 1,
      ask: 2,
      lastTradePrice: 240.1,
      suspended: true,
      lastTradeAt: new Date('2026-10-06T17:15:00Z'),
      high: null,
      low: null,
      volume: null,
      value: null,
      week52High: null,
      peRatio: null,
      marketCap: null,
    });
    expect(quote.ticker.value).toBe('NVDA');
  });

  it('leaves change unknown without a previous close, and the trade price unknown for a close', () => {
    const noBase = quoteFromLatestPrice(aUsInstrument(), aLatestPrice({ previousClose: null }));
    expect(noBase).toMatchObject({ change: null, changePercent: null, lastTradePrice: null });
    const zeroBase = quoteFromLatestPrice(aUsInstrument(), aLatestPrice({ previousClose: 0, last: 1 }));
    expect(zeroBase).toMatchObject({ change: 1, changePercent: null });
    const noLast = quoteFromLatestPrice(aUsInstrument(), aLatestPrice({ last: null }));
    expect(noLast).toMatchObject({ last: null, change: null });
  });
});
