import { describe, expect, it } from 'vitest';
import {
  anOrderBook,
  COMI_ID,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { GetMarketDepth } from '../get-market-depth';

const levels = (start: number, step: number) =>
  Array.from({ length: 12 }, (_, i) => ({ price: start + i * step, quantity: 1, orders: null }));

describe('GetMarketDepth', () => {
  it('declares its contract', async () => {
    const uc = new GetMarketDepth(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_market_depth', kind: 'query', context: 'market-data' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', levels: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', levels: 51 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', depth: 5 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('trims to 10 levels by default via run() and computes the spread from the full book', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    deps.repository.orderBook = anOrderBook({ bids: levels(99, -0.1), asks: levels(101, 0.1) });
    const out = await new GetMarketDepth(deps).run({ symbol: 'COMI' });
    expect(out.ticker).toBe('COMI');
    expect(out.bids).toHaveLength(10);
    expect(out.asks).toHaveLength(10);
    expect(out.totalBidQuantity).toBe(300);
    expect(out.spread).toEqual({ absolute: 2, percent: 2 });
    expect(deps.repository.calls.getOrderBook.map((id) => id.value)).toEqual([COMI_ID]);
  });

  it('defaults and clamps levels when executed directly', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    deps.repository.orderBook = anOrderBook({ bids: levels(99, -0.1), asks: levels(101, 0.1) });
    const uc = new GetMarketDepth(deps);
    expect((await uc.execute({ symbol: 'COMI' })).bids).toHaveLength(10);
    expect((await uc.execute({ symbol: 'COMI', levels: 0 })).bids).toHaveLength(1);
    expect((await uc.execute({ symbol: 'COMI', levels: 3 })).asks).toHaveLength(3);
    expect((await uc.execute({ symbol: 'COMI', levels: 99 })).bids).toHaveLength(12);
  });
});
