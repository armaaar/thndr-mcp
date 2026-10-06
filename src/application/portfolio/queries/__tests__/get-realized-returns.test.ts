import { describe, expect, it } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import { GetRealizedReturns } from '../get-realized-returns';

describe('GetRealizedReturns', () => {
  it('declares its contract and defaults to 1M', async () => {
    const { deps, repository } = setupPortfolio();
    const uc = new GetRealizedReturns(deps);
    expect(uc).toMatchObject({ name: 'get_realized_returns', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ interval: '5Y' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ range: '1M' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await uc.run({})).interval).toBe('1M');
    expect(repository.getReturnsChart).toHaveBeenCalledWith('1M', 'egypt');
  });

  it('combines current returns with a sorted chart and summary', async () => {
    const { deps, repository } = setupPortfolio();
    const out = await new GetRealizedReturns(deps).run({ interval: '6M', market: 'us' });
    expect(repository.getReturnsChart).toHaveBeenCalledWith('6M', 'us');
    expect(repository.getRealizedReturns).toHaveBeenCalledWith('us');
    expect(out.current.totalReturns).toBe(300);
    expect(out.series.map((p) => p.totalReturns)).toEqual([100, 300]);
    expect(out.seriesSummary).toMatchObject({ returnsChange: 200, portfolioValueChangePercent: 10 });
    expect(out.interval).toBe('6M');
  });
});
