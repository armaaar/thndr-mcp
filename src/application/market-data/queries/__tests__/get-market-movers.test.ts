import { describe, expect, it } from 'vitest';
import { aMover } from '../../../../__tests__/support/discovery-builders';
import { setupMarketData } from '../../../../__tests__/support/fake-market-data';
import { GetMarketMovers } from '../get-market-movers';

function setup() {
  const deps = setupMarketData();
  deps.discovery.movers['egypt:gainers'] = {
    movers: [aMover('DAPH', 10.75, { price: 105.7, changePercent: 10.75 }), aMover('DTPP', 8.58)],
    updatedAt: new Date('2026-10-06T14:00:25Z'),
  };
  deps.discovery.movers['egypt:losers'] = {
    movers: [aMover('ACAMD', -4.2)],
    updatedAt: new Date('2026-10-06T14:05:00Z'),
  };
  return deps;
}

describe('GetMarketMovers', () => {
  it('declares its contract', async () => {
    const uc = new GetMarketMovers(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_market_movers', kind: 'query', context: 'market-data' });
    for (const input of [{ type: 'active' }, { period: '2D' }, { limit: 0 }, { limit: 51 }]) {
      await expect(uc.run(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('returns both lists of the default market for today by default', async () => {
    const deps = setup();
    const out = await new GetMarketMovers(deps).run({});
    expect(deps.discovery.calls.getMovers).toEqual([
      { market: 'egypt', type: 'gainers', period: '1D', limit: 10 },
      { market: 'egypt', type: 'losers', period: '1D', limit: 10 },
    ]);
    expect(out.market).toBe('egypt');
    expect(out.period).toBe('1D');
    expect(out.updatedAt).toBe('2026-10-06T14:05:00.000Z');
    expect(out.gainers?.map((m) => [m.ticker, m.returnPercent])).toEqual([
      ['DAPH', 10.75],
      ['DTPP', 8.58],
    ]);
    expect(out.gainers?.[0]).toMatchObject({
      name: 'DAPH Corp',
      assetClass: 'STOCK',
      sector: 'Banks',
      currency: 'EGP',
      price: 105.7,
      changePercent: 10.75,
      tradable: true,
    });
    expect(out.losers?.map((m) => m.ticker)).toEqual(['ACAMD']);
  });

  it('returns one list for one type, capped to the limit', async () => {
    const deps = setup();
    const out = await new GetMarketMovers(deps).run({ type: 'gainers', period: '1Y', limit: 1 });
    expect(deps.discovery.calls.getMovers).toEqual([
      { market: 'egypt', type: 'gainers', period: '1Y', limit: 1 },
    ]);
    expect(out.gainers?.map((m) => m.ticker)).toEqual(['DAPH']);
    expect(out).not.toHaveProperty('losers');

    const losers = await new GetMarketMovers(setup()).run({ type: 'losers', market: 'us' });
    expect(losers).toMatchObject({ market: 'us', losers: [], updatedAt: null });
    expect(losers).not.toHaveProperty('gainers');
  });

  it('refuses markets Thndr does not rank, without calling Thndr', async () => {
    const deps = setup();
    await expect(new GetMarketMovers(deps).run({ market: 'uae' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
      message: expect.stringContaining('egypt, us'),
    });
    expect(deps.discovery.calls.getMovers).toEqual([]);
  });
});
