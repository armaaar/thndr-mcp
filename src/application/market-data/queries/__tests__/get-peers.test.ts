import { describe, expect, it } from 'vitest';
import {
  aLatestPrice,
  anInstrument,
  aQuote,
  aUsInstrument,
  COMI_ID,
  FakeMarketDataRepository,
  idFor,
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
    egypt.push(aQuote({ ticker: 'BNK3', sector: 'Banking', marketCap: 0.5 }));
    deps.repository.quotes.egypt = egypt;
    const out = await new GetPeers(deps).run({ symbol: 'COMI', limit: 1 });
    expect(out.sector).toBe('Banking');
    expect(out.similar.map((p) => p.ticker)).toEqual(['ADIB']);
    expect(out.sameSector.map((p) => p.ticker)).toEqual(['BNK2']);
    // The total counts the whole sector, before the limit.
    expect(out.sameSectorTotal).toBe(2);
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

  describe('outside Egypt', () => {
    function foreign(market: 'us' | 'uae') {
      const own =
        market === 'us' ? aUsInstrument() : anInstrument({ ticker: 'FAB', market: 'uae', sector: 'Banks' });
      const repository = new FakeMarketDataRepository({ instruments: [own] });
      repository.similar = {
        [own.id.value]: [
          own,
          aUsInstrument({ ticker: 'AMD', name: 'Advanced Micro Devices', market, sector: 'Semis' }),
          aUsInstrument({ ticker: 'INTC', market }),
        ],
      };
      repository.latestPrices = [aLatestPrice({ ticker: 'AMD', last: 110, previousClose: 100 })];
      return { own, repository, deps: setupMarketData(repository) };
    }

    it.each(['us', 'uae'] as const)(
      'lists similar stocks with bulk prices and an empty same-sector list in %s, without marketwatch',
      async (market) => {
        const { own, repository, deps } = foreign(market);
        const out = await new GetPeers(deps).run({ symbol: own.ticker.value, market });
        expect(repository.calls.getMarketQuotes).toEqual([]);
        expect(repository.calls.getSimilarInstruments[0]).toMatchObject({ market });
        expect(repository.calls.getLatestPrices).toEqual([[idFor('AMD'), idFor('INTC')]]);
        expect(out).toMatchObject({ market, sector: own.sector, sameSector: [], sameSectorTotal: 0 });
        expect(out.similar).toEqual([
          {
            ticker: 'AMD',
            name: 'Advanced Micro Devices',
            sector: 'Semis',
            last: 110,
            changePercent: 10,
            value: null,
            marketCap: null,
            peRatio: null,
            dividendYieldPercent: null,
          },
          expect.objectContaining({ ticker: 'INTC', last: null }),
        ]);
        expect(out.notes?.[0]).toMatch(/only for Egypt/);
      },
    );

    it('skips the price call when Thndr has no similar stocks', async () => {
      const { repository, deps } = foreign('us');
      repository.similar = {};
      const out = await new GetPeers(deps).run({ symbol: 'NVDA', market: 'us' });
      expect(out.similar).toEqual([]);
      expect(repository.calls.getLatestPrices).toEqual([]);
    });

    it('uses Egypt’s snapshot for an Egyptian listing found through the simulator', async () => {
      const deps = setup();
      deps.repository.searchInstruments = async () => [anInstrument({ ticker: 'COMI', sector: 'Banking' })];
      const out = await new GetPeers(deps).run({ symbol: 'COMI', market: 'simulator' });
      expect(deps.repository.calls.getMarketQuotes).toEqual(['egypt']);
      expect(deps.repository.calls.getSimilarInstruments[0]).toMatchObject({ market: 'egypt' });
      expect(out.sameSectorTotal).toBeGreaterThan(0);
      expect(out.notes).toBeUndefined();
    });

    it('treats an instrument whose market is the simulator itself as Egyptian data', async () => {
      const repository = new FakeMarketDataRepository({
        instruments: [anInstrument({ ticker: 'COMI', market: 'simulator' })],
      });
      const out = await new GetPeers(setupMarketData(repository)).run({
        symbol: 'COMI',
        market: 'simulator',
      });
      expect(repository.calls.getMarketQuotes).toEqual(['egypt']);
      expect(out.sameSector).toEqual([]);
    });
  });
});
