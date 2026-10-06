import { describe, expect, it } from 'vitest';
import { GetMarketStatus } from '../../../../src/application/market-data/queries/get-market-status';
import { aQuote, setupMarketData } from '../../../support/fake-market-data';

describe('GetMarketStatus', () => {
  it('declares its contract', async () => {
    const uc = new GetMarketStatus(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_market_status', kind: 'query', context: 'market-data' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ board: 'NOPL' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('combines the session of the default market with index levels', async () => {
    const deps = setupMarketData();
    deps.repository.indicators.egypt = [
      aQuote({ ticker: 'EGX30', last: 30_000, changePercent: 1.5, previousClose: 29_556 }),
    ];
    const out = await new GetMarketStatus(deps).run(undefined);
    expect(out).toMatchObject({ market: 'egypt', isOpen: true });
    expect(out.indices).toEqual([
      { ticker: 'EGX30', level: 30_000, changePercent: 1.5, previousClose: 29_556 },
    ]);
    expect(deps.repository.calls.getMarketSession).toEqual([{ market: 'egypt', board: undefined }]);
    expect(deps.repository.calls.getMarketIndicators).toEqual(['egypt']);
  });

  it('still answers when indicators fail', async () => {
    const deps = setupMarketData();
    deps.repository.failures.getMarketIndicators = new Error('down');
    const out = await new GetMarketStatus(deps).run({ market: 'us' });
    expect(out).toMatchObject({ market: 'us', indices: [] });
  });

  it('propagates a session failure', async () => {
    const deps = setupMarketData();
    deps.repository.failures.getMarketSession = new Error('session down');
    await expect(new GetMarketStatus(deps).run({})).rejects.toThrow('session down');
  });
});
