import { describe, expect, it } from 'vitest';
import { GetRecentTrades } from '../../../../src/application/market-data/queries/get-recent-trades';
import { aTapeTrade, setupMarketData, withInstruments } from '../../../support/fake-market-data';

describe('GetRecentTrades', () => {
  it('declares its contract', async () => {
    const uc = new GetRecentTrades(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_recent_trades', kind: 'query', context: 'market-data' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', limit: 201 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', cursor: '1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('applies the default limit of 50 via run() and has no cursor when empty', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    const out = await new GetRecentTrades(deps).run({ symbol: 'COMI' });
    expect(out).toEqual({ ticker: 'COMI', trades: [], nextCursor: null });
    expect(deps.repository.calls.getRecentTrades[0]).toMatchObject({ limit: 50, before: undefined });
  });

  it('passes limit and cursor through and exposes the next cursor', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    deps.repository.trades = [aTapeTrade({ cursor: '9' }), aTapeTrade({ cursor: '8' })];
    const out = await new GetRecentTrades(deps).run({ symbol: 'COMI', limit: 5, before: '10' });
    expect(out).toMatchObject({ ticker: 'COMI', nextCursor: '8' });
    expect(out.trades).toHaveLength(2);
    expect(deps.repository.calls.getRecentTrades[0]).toMatchObject({ limit: 5, before: '10' });
  });

  it('defaults and clamps the limit when executed directly', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    const uc = new GetRecentTrades(deps);
    await uc.execute({ symbol: 'COMI' });
    await uc.execute({ symbol: 'COMI', limit: -5 });
    await uc.execute({ symbol: 'COMI', limit: 500 });
    expect(deps.repository.calls.getRecentTrades.map((c) => c.limit)).toEqual([50, 1, 200]);
  });
});
