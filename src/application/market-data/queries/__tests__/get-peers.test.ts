import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  aQuote,
  COMI_ID,
  FakeMarketDataRepository,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { GetPeers } from '../get-peers';

function setup() {
  const repository = new FakeMarketDataRepository({
    instruments: [anInstrument({ ticker: 'COMI', sector: 'Banking' })],
    quotes: {
      egypt: [
        aQuote({ ticker: 'COMI', sector: 'Banks', marketCap: 500 }),
        aQuote({ ticker: 'ADIB', sector: 'Banks', marketCap: 100, peRatio: 6 }),
        aQuote({ ticker: 'CANA', sector: ' banks ', marketCap: 200 }),
        aQuote({ ticker: 'SAUD', sector: 'Banks', marketCap: null }),
        aQuote({ ticker: 'HRHO', sector: 'Financial Services', marketCap: 900 }),
        aQuote({ ticker: 'BANKSIDX', sector: 'Banks', board: 'INDX', marketCap: 10_000, value: 1e12 }),
      ],
    },
  });
  repository.similar = {
    [COMI_ID]: [
      anInstrument({ ticker: 'ADIB' }),
      anInstrument({ ticker: 'COMI' }),
      anInstrument({ ticker: 'NEWCO', name: 'New Co', sector: 'Banks' }),
    ],
  };
  return setupMarketData(repository);
}

describe('GetPeers', () => {
  it('declares its contract', async () => {
    const uc = new GetPeers(setup());
    expect(uc).toMatchObject({ name: 'get_peers', kind: 'query', context: 'market-data' });
    for (const bad of [{}, { symbol: 'COMI', limit: 0 }, { symbol: 'COMI', limit: 21 }]) {
      await expect(uc.run(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it("returns Thndr's similar stocks and the largest same-sector instruments, never the instrument or an index", async () => {
    const deps = setup();
    const out = await new GetPeers(deps).run({ symbol: 'comi' });
    expect(deps.repository.calls.getSimilarInstruments.map((c) => [c.id.value, c.market, c.limit])).toEqual([
      [COMI_ID, 'egypt', 5],
    ]);
    expect(out.ticker).toBe('COMI');
    expect(out.sector).toBe('Banks');
    expect(out.similar).toEqual([
      {
        ticker: 'ADIB',
        name: 'ADIB Corp',
        sector: 'Banks',
        last: 100,
        changePercent: 2.04,
        value: 100_000_000,
        marketCap: 100,
        peRatio: 6,
        dividendYieldPercent: 3,
      },
      {
        ticker: 'NEWCO',
        name: 'New Co',
        sector: 'Banks',
        last: null,
        changePercent: null,
        value: null,
        marketCap: null,
        peRatio: null,
        dividendYieldPercent: null,
      },
    ]);
    expect(out.sameSector.map((p) => p.ticker)).toEqual(['CANA', 'ADIB', 'SAUD']);
    expect(out.sameSectorTotal).toBe(3);
  });

  it('limits both lists and falls back to the instrument sector when it has no quote', async () => {
    const deps = setup();
    const egypt = deps.repository.quotes.egypt!.filter((q) => q.ticker.value !== 'COMI');
    egypt.push(aQuote({ ticker: 'BNK2', sector: 'Banking', marketCap: 1 }));
    deps.repository.quotes.egypt = egypt;
    const out = await new GetPeers(deps).run({ symbol: 'COMI', limit: 1 });
    expect(out.sector).toBe('Banking');
    expect(out.similar.map((p) => p.ticker)).toEqual(['ADIB']);
    expect(out.sameSector.map((p) => p.ticker)).toEqual(['BNK2']);
  });

  it('handles a sectorless instrument and clamps the limit when executed directly', async () => {
    const deps = setup();
    deps.repository.instruments = [anInstrument({ ticker: 'COMI', sector: null })];
    deps.repository.quotes.egypt = [
      aQuote({ ticker: 'COMI', sector: null }),
      aQuote({ ticker: 'X', sector: null }),
    ];
    const out = await new GetPeers(deps).execute({ symbol: 'COMI', limit: 0 });
    expect(out).toMatchObject({ sector: null, sameSector: [], sameSectorTotal: 0 });
    expect(out.similar.map((p) => p.ticker)).toEqual(['ADIB']);
  });
});
