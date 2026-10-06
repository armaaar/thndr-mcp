import { describe, expect, it, vi } from 'vitest';
import { position, setupPortfolio, summary } from '../../../../__tests__/support/fake-portfolio';
import { GetPositions } from '../get-positions';

describe('GetPositions', () => {
  it('declares its contract', async () => {
    const uc = new GetPositions(setupPortfolio().deps);
    expect(uc).toMatchObject({ name: 'get_account_positions', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ sort_by: 'ticker' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ sortBy: 'price' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ order: 'up' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('sorts by market value (desc) and attaches weights by default', async () => {
    const { deps, repository } = setupPortfolio();
    const out = await new GetPositions(deps).run({});
    expect(repository.getAccount).toHaveBeenCalledWith('egypt');
    expect(out.positions.map((p) => [p.ticker.value, p.weightPercent])).toEqual([
      ['COMI', 60],
      ['HRHO', 30],
      ['ZERO', 0],
    ]);
    expect(out).toMatchObject({ market: 'egypt', currency: 'EGP', portfolioValue: 10_000, totalReturn: 500 });
    expect(out.allocation.basis).toBe(10_000);
  });

  it('applies the same defaults when executed directly', async () => {
    const { deps } = setupPortfolio();
    const out = await new GetPositions(deps).execute({});
    expect(out.positions.map((p) => p.ticker.value)).toEqual(['COMI', 'HRHO', 'ZERO']);
  });

  it('supports ascending, ticker and null-aware sorting', async () => {
    const { deps } = setupPortfolio();
    const uc = new GetPositions(deps);
    const asc = await uc.run({ order: 'asc' });
    expect(asc.positions.map((p) => p.ticker.value)).toEqual(['HRHO', 'COMI', 'ZERO']);
    const byTicker = await uc.run({ sortBy: 'ticker', order: 'asc' });
    expect(byTicker.positions.map((p) => p.ticker.value)).toEqual(['COMI', 'HRHO', 'ZERO']);
  });

  it('keeps two null values in place', async () => {
    const { deps } = setupPortfolio({
      getAccount: vi.fn(async () => ({
        summary,
        positions: [position('A', null), position('B', null), position('C', 10)],
      })),
    });
    const out = await new GetPositions(deps).run({ sortBy: 'unrealizedPnl' });
    expect(out.positions.map((p) => p.ticker.value)).toEqual(['C', 'A', 'B']);
  });
});
