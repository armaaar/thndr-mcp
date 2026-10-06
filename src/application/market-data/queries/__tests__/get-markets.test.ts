import { describe, expect, it } from 'vitest';
import { setupMarketData } from '../../../../__tests__/support/fake-market-data';
import { GetMarkets } from '../get-markets';

describe('GetMarkets', () => {
  it('declares its contract', async () => {
    const uc = new GetMarkets(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_markets', kind: 'query', context: 'market-data' });
    await expect(uc.run({ market: 'egypt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("lists the user's markets with their profile, restrictions and capabilities", async () => {
    const deps = setupMarketData();
    deps.discovery.access = {
      markets: [
        { market: 'egypt', restricted: false, restrictionReason: null },
        { market: 'uae', restricted: true, restrictionReason: 'NOT_THNDR_FORTUNE' },
        { market: 'simulator', restricted: false, restrictionReason: null },
      ],
      defaultMarket: 'egypt',
      otherMarkets: ['tdwl'],
    };
    const out = await new GetMarkets(deps).run({});
    expect(deps.discovery.calls.getVisibleMarkets).toBe(1);
    expect(out.defaultMarket).toBe('egypt');
    expect(out.otherThndrMarkets).toEqual(['tdwl']);
    expect(out.markets.map((m) => [m.market, m.currency, m.timeZone, m.restricted])).toEqual([
      ['egypt', 'EGP', 'Africa/Cairo', false],
      ['uae', 'AED', 'Asia/Dubai', true],
      ['simulator', 'EGP', 'Africa/Cairo', false],
    ]);
    const [egypt, uae, simulator] = out.markets;
    expect(egypt?.supports).toEqual(expect.arrayContaining(['orderBook', 'movers', 'tags', 'trending']));
    expect(egypt?.lacks).toEqual([]);
    expect(uae).toMatchObject({
      name: expect.stringContaining('ADX'),
      restrictionReason: 'NOT_THNDR_FORTUNE',
    });
    expect(uae?.supports).toContain('trending');
    expect(uae?.lacks).toEqual(expect.arrayContaining(['orderBook', 'movers', 'tags', 'candles']));
    expect(simulator?.supports).toEqual(['account']);
    expect(out.features.movers).toBe('top gainers and losers');
    expect(out.note).toContain('simulator');
    expect(out.note).toContain('get_price_snapshot');
    expect(out.note).toContain('closing prices elsewhere');
  });

  it('propagates a failure', async () => {
    const deps = setupMarketData();
    deps.discovery.failures.getVisibleMarkets = new Error('down');
    await expect(new GetMarkets(deps).run(undefined)).rejects.toThrow('down');
  });
});
