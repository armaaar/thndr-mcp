import { describe, expect, it } from 'vitest';
import { aDividend } from '../../../../__tests__/support/fake-discovery';
import { COMI_ID, setupMarketData, withInstruments } from '../../../../__tests__/support/fake-market-data';
import type { DividendPage } from '../../../../domain/market-data/discovery';
import { GetDividends } from '../get-dividends';

function setup() {
  const deps = setupMarketData(withInstruments('COMI'));
  deps.discovery.dividends[COMI_ID] = [
    aDividend(),
    aDividend({
      id: '1063',
      type: 'STOCK',
      recordDate: '2025-12-16',
      ratio: 0.1,
      distributions: [{ date: '2025-12-17', ratio: 0.1 }],
    }),
    aDividend({ id: '9', type: 'UNKNOWN', status: 'UPCOMING', ratio: 2, couponNumber: '47' }),
  ];
  return deps;
}

describe('GetDividends', () => {
  it('declares its contract', async () => {
    const uc = new GetDividends(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_dividends', kind: 'query', context: 'market-data' });
    for (const input of [{}, { symbol: 'COMI', page: 0 }, { symbol: 'COMI', limit: 51 }]) {
      await expect(uc.run(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('labels cash and stock ratios and pages the list', async () => {
    const deps = setup();
    const out = await new GetDividends(deps).run({ symbol: 'comi', limit: 2 });
    expect(deps.discovery.calls.getDividends).toEqual([{ id: COMI_ID, page: 1, pageSize: 2 }]);
    expect(out).toMatchObject({
      ticker: 'COMI',
      name: 'COMI Corp',
      page: 1,
      pageSize: 2,
      total: 3,
      hasMore: true,
    });
    expect(out.dividends).toEqual([
      {
        id: '1086',
        type: 'CASH',
        status: 'PAST',
        recordDate: '2026-04-06',
        cashPerShare: 6,
        currency: 'EGP',
        frequency: 'ONE_TIME',
        couponNumber: null,
        distributions: [{ date: '2026-04-09', ratio: 6 }],
      },
      {
        id: '1063',
        type: 'STOCK',
        status: 'PAST',
        recordDate: '2025-12-16',
        bonusSharesPerShare: 0.1,
        currency: 'EGP',
        frequency: 'ONE_TIME',
        couponNumber: null,
        distributions: [{ date: '2025-12-17', ratio: 0.1 }],
      },
    ]);
    const last = await new GetDividends(deps).run({ symbol: 'COMI', limit: 2, page: 2 });
    expect(last.hasMore).toBe(false);
    expect(last.dividends[0]).toMatchObject({ id: '9', ratio: 2, couponNumber: '47' });
    expect(last.dividends[0]).not.toHaveProperty('cashPerShare');
  });

  it('accepts an empty history and guesses more pages when Thndr gives no total', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    expect(await new GetDividends(deps).run({ symbol: 'COMI' })).toMatchObject({
      total: 0,
      hasMore: false,
      dividends: [],
    });
    const page: DividendPage = { dividends: [aDividend()], total: null };
    deps.discovery.getDividends = async () => page;
    expect((await new GetDividends(deps).run({ symbol: 'COMI', limit: 1 })).hasMore).toBe(true);
    expect((await new GetDividends(deps).run({ symbol: 'COMI', limit: 2 })).hasMore).toBe(false);
  });

  it('propagates resolution and upstream errors', async () => {
    const deps = setup();
    await expect(new GetDividends(deps).run({ symbol: 'NOPE' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    deps.discovery.failures.getDividends = new Error('down');
    await expect(new GetDividends(deps).run({ symbol: 'COMI' })).rejects.toThrow('down');
  });
});
