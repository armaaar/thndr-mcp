import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  FakeMarketDataRepository,
  idFor,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { AssetId } from '../../../../domain/shared-kernel/asset-id';
import { GetTrending } from '../get-trending';

function setup() {
  const repository = new FakeMarketDataRepository({
    instruments: [
      anInstrument({ ticker: 'NVDA', market: 'us', currency: 'USD', sector: 'Semiconductors' }),
      anInstrument({ ticker: 'SPY', market: 'us', assetClass: 'ETF', sector: null }),
    ],
  });
  const deps = setupMarketData(repository);
  deps.discovery.trending.us = [
    AssetId.of(idFor('NVDA')),
    AssetId.of(idFor('GONE')),
    AssetId.of(idFor('SPY')),
  ];
  return deps;
}

describe('GetTrending', () => {
  it('declares its contract', async () => {
    const uc = new GetTrending(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_trending', kind: 'query', context: 'market-data' });
    for (const input of [{ limit: 0 }, { limit: 21 }, { stocksOnly: 'yes' }]) {
      await expect(uc.run(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('names the trending instruments in order and keeps the ids it cannot name', async () => {
    const deps = setup();
    const out = await new GetTrending(deps).run({ market: 'us', stocksOnly: true, limit: 3 });
    expect(deps.discovery.calls.getTrendingIds).toEqual([{ market: 'us', count: 3, stocksOnly: true }]);
    expect(out).toEqual({
      market: 'us',
      stocksOnly: true,
      items: [
        {
          rank: 1,
          instrumentId: idFor('NVDA'),
          ticker: 'NVDA',
          name: 'NVDA Corp',
          assetClass: 'STOCK',
          sector: 'Semiconductors',
        },
        { rank: 2, instrumentId: idFor('GONE'), ticker: null, name: null, assetClass: null, sector: null },
        {
          rank: 3,
          instrumentId: idFor('SPY'),
          ticker: 'SPY',
          name: 'SPY Corp',
          assetClass: 'ETF',
          sector: null,
        },
      ],
    });
  });

  it('defaults to ten instruments of Egypt and caps what Thndr returns', async () => {
    const deps = setup();
    deps.discovery.trending.egypt = Array.from({ length: 12 }, (_, i) => AssetId.of(idFor(`T${i}`)));
    const out = await new GetTrending(deps).run({});
    expect(deps.discovery.calls.getTrendingIds).toEqual([{ market: 'egypt', count: 10, stocksOnly: false }]);
    expect(out.items).toHaveLength(10);
  });

  it('serves the UAE but not the simulator', async () => {
    const deps = setup();
    expect((await new GetTrending(deps).run({ market: 'uae' })).items).toEqual([]);
    await expect(new GetTrending(deps).run({ market: 'simulator' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
