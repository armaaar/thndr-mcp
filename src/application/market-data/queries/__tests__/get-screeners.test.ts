import { describe, expect, it } from 'vitest';
import {
  aScreener,
  FakeMarketDataRepository,
  setupMarketData,
} from '../../../../__tests__/support/fake-market-data';
import { GetScreeners } from '../get-screeners';

describe('GetScreeners', () => {
  it('declares its contract', async () => {
    const uc = new GetScreeners(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_screeners', kind: 'query', context: 'market-data' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("lists the user's saved screeners of the market with readable filters, then the presets", async () => {
    const repository = new FakeMarketDataRepository();
    repository.screeners = [
      aScreener({
        id: 's1',
        name: 'Big dividends',
        filters: [{ field: 'dividendYieldPercent', condition: { kind: 'between', min: 5, max: null } }],
        unsupported: ['filter key "ref_price" is not supported'],
      }),
      aScreener({ id: 's2', market: 'us' }),
    ];
    const deps = setupMarketData(repository);
    const out = await new GetScreeners(deps).run({});
    expect(deps.repository.calls.getScreeners).toEqual(['egypt']);
    expect(out.market).toBe('egypt');
    expect(out.saved).toEqual([
      {
        id: 's1',
        name: 'Big dividends',
        filters: ['dividendYieldPercent ≥ 5'],
        unsupported: ['filter key "ref_price" is not supported'],
      },
    ]);
    expect(out.presets.map((p) => p.id)).toEqual([
      'momentum-movers',
      'breakout-radar',
      'value-yield',
      'steady-performers',
      'reversal-watch',
    ]);
    expect(out.presets[0]).toEqual({
      id: 'momentum-movers',
      name: 'Momentum Movers',
      filters: ['value ≥ 1,000,000', 'relativeVolume ≥ 100', 'week52HighDistance ≤ 10', 'changePercent ≥ 2'],
      unsupported: [],
    });
  });
});
