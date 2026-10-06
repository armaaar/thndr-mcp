import { describe, expect, it, vi } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import { GetSavings } from '../get-savings';

describe('GetSavings', () => {
  it('declares a read-only contract without inputs', async () => {
    const uc = new GetSavings(setupPortfolio().deps);
    expect(uc).toMatchObject({ name: 'get_savings', kind: 'query', context: 'portfolio' });
    expect(uc.description).toMatch(/Read-only/);
    await expect(uc.run({ market: 'egypt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('combines balances and product yields', async () => {
    const cloud = {
      id: 'c1',
      name: 'Rainy day',
      type: 'INSTANT_EGP',
      amount: 5_000,
      gains: 120,
      withdrawableAmount: 5_000,
    };
    const yields = [
      {
        product: 'INSTANT_EGP',
        currentlyEarningPercent: 17.31,
        lastUpdatedAt: '2026-10-06T15:02:19',
        nominalYieldsPercent: {
          daily: 15.97,
          weekly: 15.99,
          monthly: 16.07,
          quarterly: 16.29,
          semiAnnually: 16.62,
        },
      },
    ];
    const { deps } = setupPortfolio({
      getSavings: vi.fn(async () => ({
        totalAmount: 5_000,
        totalGain: 120,
        count: 1,
        amountsPerType: { INSTANT_EGP: 5_000 },
        clouds: [cloud],
      })),
      getSavingsYields: vi.fn(async () => yields),
    });
    const out = await new GetSavings(deps).run({});
    expect(out).toMatchObject({
      currency: 'EGP',
      totalAmount: 5_000,
      totalGain: 120,
      count: 1,
      amountsPerType: { INSTANT_EGP: 5_000 },
      clouds: [cloud],
      yields,
    });
    expect(out.note).toMatch(/Read-only/);
  });
});
