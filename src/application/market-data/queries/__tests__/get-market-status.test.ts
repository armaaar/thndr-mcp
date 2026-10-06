import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  aQuote,
  FakeMarketDataRepository,
  idFor,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { AssetId } from '../../../../domain/shared-kernel/asset-id';
import { GetMarketStatus } from '../get-market-status';

const ids = (...tickers: string[]) => tickers.map((t) => AssetId.of(idFor(t)));

/** Thndr's levels feed mixes every market's indicators whatever market is asked. */
function setup() {
  const repository = new FakeMarketDataRepository({
    // FADGI has no details here: it is kept because the feed has it.
    instruments: [
      anInstrument({ ticker: 'EGX30', market: 'egypt', assetClass: 'INDEX' }),
      anInstrument({ ticker: 'SPY', market: 'us', assetClass: 'ETF' }),
      anInstrument({ ticker: 'QQQ', market: 'us', assetClass: 'ETF' }),
      anInstrument({ ticker: 'FADX15', name: 'FTSE ADX 15', market: 'uae', assetClass: 'INDEX' }),
    ],
  });
  const deps = setupMarketData(repository);
  const feed = [
    aQuote({ ticker: 'EGX30', name: 'EGX 30', last: 30_000, changePercent: 1.5, previousClose: 29_556 }),
    aQuote({ ticker: 'SPY', name: 'SPDR S&P 500', last: 600, changePercent: -0.4, previousClose: 602.4 }),
    aQuote({ ticker: 'QQQ', name: null, last: 500, changePercent: 0.2, previousClose: 499 }),
    aQuote({
      ticker: 'FADGI',
      name: 'FTSE ADX General',
      last: 10_000,
      changePercent: 0.1,
      previousClose: 9990,
    }),
  ];
  for (const market of ['egypt', 'us', 'uae'] as const) repository.indicators[market] = feed;
  deps.discovery.defaultIndicators = {
    egypt: ids('EGX30'),
    us: ids('QQQ', 'SPY'),
    uae: ids('FADGI', 'FADX15', 'GONE'),
  };
  return deps;
}

describe('GetMarketStatus', () => {
  it('declares its contract', async () => {
    const uc = new GetMarketStatus(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_market_status', kind: 'query', context: 'market-data' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ board: 'NOPL' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("combines the session of the default market with that market's indices", async () => {
    const deps = setup();
    const out = await new GetMarketStatus(deps).run(undefined);
    expect(out).toMatchObject({ market: 'egypt', isOpen: true });
    expect(out.indices).toEqual([
      { ticker: 'EGX30', name: 'EGX 30', level: 30_000, changePercent: 1.5, previousClose: 29_556 },
    ]);
    expect(deps.repository.calls.getMarketSession).toEqual([{ market: 'egypt', board: undefined }]);
    expect(deps.repository.calls.getMarketIndicators).toEqual(['egypt']);
    expect(deps.discovery.calls.getDefaultIndicatorIds).toEqual(['egypt']);
  });

  it('lists the US benchmarks in Thndr’s order', async () => {
    const out = await new GetMarketStatus(setup()).run({ market: 'us' });
    expect(out.indices.map((i) => [i.ticker, i.level])).toEqual([
      ['QQQ', 500],
      ['SPY', 600],
    ]);
  });

  it("drops another market's indicators when the gateway's list mixes markets", async () => {
    const deps = setup();
    deps.discovery.defaultIndicators.us = ids('EGX30', 'SPY', 'FADX15', 'QQQ');
    const out = await new GetMarketStatus(deps).run({ market: 'us' });
    expect(out.indices.map((i) => i.ticker)).toEqual(['SPY', 'QQQ']);
  });

  it('names default indices missing from the feed and drops the ones it cannot load', async () => {
    const out = await new GetMarketStatus(setup()).run({ market: 'uae' });
    expect(out.indices).toEqual([
      { ticker: 'FADGI', name: 'FTSE ADX General', level: 10_000, changePercent: 0.1, previousClose: 9990 },
      { ticker: 'FADX15', name: 'FTSE ADX 15', level: null, changePercent: null, previousClose: null },
    ]);
  });

  it('without the default list, keeps the whole feed for Egypt only', async () => {
    const deps = setup();
    deps.discovery.failures.getDefaultIndicatorIds = new Error('gateway down');
    expect((await new GetMarketStatus(deps).run({})).indices).toHaveLength(4);
    expect((await new GetMarketStatus(deps).run({ market: 'us' })).indices).toEqual([]);
    deps.discovery.failures = {};
    deps.discovery.defaultIndicators.us = [];
    expect((await new GetMarketStatus(deps).run({ market: 'us' })).indices).toEqual([]);
  });

  it('still answers when the levels feed fails', async () => {
    const deps = setup();
    deps.repository.failures.getMarketIndicators = new Error('down');
    const out = await new GetMarketStatus(deps).run({ market: 'egypt' });
    expect(out).toMatchObject({
      market: 'egypt',
      indices: [
        { ticker: 'EGX30', name: 'EGX30 Corp', level: null, changePercent: null, previousClose: null },
      ],
    });
  });

  it('propagates a session failure and refuses the simulator', async () => {
    const deps = setup();
    deps.repository.failures.getMarketSession = new Error('session down');
    await expect(new GetMarketStatus(deps).run({})).rejects.toThrow('session down');
    await expect(new GetMarketStatus(setup()).run({ market: 'simulator' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
