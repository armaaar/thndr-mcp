import { describe, expect, it } from 'vitest';
import {
  aQuote,
  FakeMarketDataRepository,
  idFor,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { GetIndexConstituents } from '../get-index-constituents';

function setup() {
  const repository = new FakeMarketDataRepository({
    quotes: {
      egypt: [
        aQuote({ ticker: 'EGX30', board: 'INDX', name: 'EGX 30', last: 30_000, changePercent: 1.2 }),
        aQuote({ ticker: 'SHARIAH', board: 'INDX', name: null, last: null, changePercent: null }),
        aQuote({ ticker: 'COMI', name: 'CIB', sector: 'Banks', last: 100, changePercent: 1, marketCap: 300 }),
        aQuote({ ticker: 'HRHO', sector: 'Financial Services', last: 20, changePercent: -2, marketCap: 50 }),
        aQuote({ ticker: 'TMGH', sector: 'Real Estate', last: 60, changePercent: 3, marketCap: null }),
      ],
    },
  });
  repository.constituents = {
    [idFor('EGX30')]: [idFor('HRHO'), idFor('COMI'), idFor('TMGH'), idFor('GONE')],
    [idFor('SHARIAH')]: [idFor('TMGH')],
  };
  return setupMarketData(repository);
}

const tickers = (out: unknown) =>
  (out as { members: Array<{ ticker: string }> }).members.map((member) => member.ticker);

describe('GetIndexConstituents', () => {
  it('declares its contract', async () => {
    const uc = new GetIndexConstituents(setup());
    expect(uc).toMatchObject({ name: 'get_index_constituents', kind: 'query', context: 'market-data' });
    for (const bad of [{ index: '' }, { sortBy: 'weight' }, { limit: 0 }, { limit: 301 }, { order: 'up' }]) {
      await expect(uc.run(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('lists the indices of the market with level, change and member count', async () => {
    expect(await new GetIndexConstituents(setup()).run({})).toEqual({
      market: 'egypt',
      indices: [
        { ticker: 'EGX30', name: 'EGX 30', level: 30_000, changePercent: 1.2, memberCount: 4 },
        { ticker: 'SHARIAH', name: null, level: null, changePercent: null, memberCount: 1 },
      ],
    });
  });

  it('returns the members of an index joined with quotes, largest market cap first, and counts the missing', async () => {
    const out = await new GetIndexConstituents(setup()).run({ index: 'egx 30' });
    expect(out).toEqual({
      market: 'egypt',
      index: { ticker: 'EGX30', name: 'EGX 30', level: 30_000, changePercent: 1.2, memberCount: 4 },
      total: 3,
      members: [
        {
          ticker: 'COMI',
          name: 'CIB',
          sector: 'Banks',
          last: 100,
          changePercent: 1,
          value: 100_000_000,
          volume: 1_000_000,
          marketCap: 300,
        },
        expect.objectContaining({ ticker: 'HRHO', marketCap: 50 }),
        expect.objectContaining({ ticker: 'TMGH', marketCap: null }),
      ],
      missingFromSnapshot: 1,
    });
  });

  it('sorts by any field in either direction and limits', async () => {
    const uc = new GetIndexConstituents(setup());
    expect(tickers(await uc.run({ index: 'EGX30', sortBy: 'changePercent' }))).toEqual([
      'TMGH',
      'COMI',
      'HRHO',
    ]);
    expect(tickers(await uc.run({ index: 'EGX30', sortBy: 'ticker' }))).toEqual(['COMI', 'HRHO', 'TMGH']);
    expect(tickers(await uc.run({ index: 'EGX30', sortBy: 'ticker', order: 'desc' }))).toEqual([
      'TMGH',
      'HRHO',
      'COMI',
    ]);
    expect(tickers(await uc.run({ index: 'EGX30', order: 'asc', limit: 2 }))).toEqual(['HRHO', 'COMI']);
  });

  it('keeps unknown values last and clamps the limit when executed directly', async () => {
    const uc = new GetIndexConstituents(setup());
    expect(tickers(await uc.execute({ index: 'EGX30', sortBy: 'marketCap', order: 'asc' }))).toEqual([
      'HRHO',
      'COMI',
      'TMGH',
    ]);
    expect(tickers(await uc.execute({ index: 'EGX30', limit: 0 }))).toEqual(['COMI']);
    expect(tickers(await uc.execute({ index: 'shariah' }))).toEqual(['TMGH']);
  });

  it('rejects an unknown index with the available ones', async () => {
    await expect(new GetIndexConstituents(setup()).run({ index: 'NOPE' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Indices: EGX30, SHARIAH.'),
    });
  });
});
