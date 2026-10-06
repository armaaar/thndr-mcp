import { describe, expect, it } from 'vitest';
import { setupMarketData } from '../../../../__tests__/support/fake-market-data';
import { someEconomicIndicators } from '../../../../__tests__/support/fake-research';
import { GetEconomicIndicators } from '../get-economic-indicators';

describe('GetEconomicIndicators', () => {
  it('declares its contract', async () => {
    const uc = new GetEconomicIndicators(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_economic_indicators', kind: 'query', context: 'market-data' });
    for (const input of [{ points: 0 }, { points: 501 }, { series: 'cpi' }]) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('returns the overview, sources and every series by default', async () => {
    const deps = setupMarketData();
    const out = await new GetEconomicIndicators(deps).run({});
    expect(deps.research.calls.getEconomicIndicators).toBe(1);
    expect(out).toEqual({ ...someEconomicIndicators(), units: expect.stringContaining('percent') });
  });

  it('keeps only the latest N points of each series', async () => {
    const out = await new GetEconomicIndicators(setupMarketData()).run({ points: 1 });
    expect(out.inflationYearly).toEqual([expect.objectContaining({ date: '2026-07-01' })]);
    expect(out.overnightRates).toEqual([expect.objectContaining({ date: '2026-08-20' })]);
    expect(out.overview).toEqual(someEconomicIndicators().overview);
    const direct = await new GetEconomicIndicators(setupMarketData()).execute({});
    expect(direct.inflationYearly).toHaveLength(2);
  });
});
