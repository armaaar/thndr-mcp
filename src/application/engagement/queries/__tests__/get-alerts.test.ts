import { describe, expect, it } from 'vitest';
import {
  anAlert,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { GetAlerts } from '../get-alerts';

function alerts(n: number) {
  return Array.from({ length: n }, (_, i) => anAlert({ id: `a-${i}`, targetPrice: 100 + i }));
}

describe('GetAlerts contract', () => {
  const uc = new GetAlerts(engagementSetup());

  it('is the get_alerts query', () => {
    expect(uc).toMatchObject({ name: 'get_alerts', kind: 'query', context: 'engagement' });
    expect(Object.keys(uc.input)).toEqual(['market', 'symbol', 'page', 'pageCount']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ page_count: 5 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ page: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ pageCount: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults to page 1 of 20 on egypt', async () => {
    const deps = engagementSetup();
    expect(await new GetAlerts(deps).run({})).toEqual({
      market: 'egypt',
      page: 1,
      pageCount: 20,
      hasMore: false,
      alerts: [],
    });
    expect(deps.repository.calls.listPriceAlerts).toEqual([{ market: 'egypt', page: 1, pageCount: 20 }]);
  });
});

describe('GetAlerts', () => {
  it('returns one page with tickers and current prices', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({
        alerts: [
          anAlert(),
          anAlert({ id: 'a-2', ticker: null, instrumentId: idFor('HRHO'), direction: null }),
        ],
      }),
    );
    const out = await new GetAlerts(deps).execute({});
    expect(deps.repository.calls.listPriceAlerts).toEqual([{ market: 'egypt', page: 1, pageCount: 20 }]);
    expect(out).toEqual({
      market: 'egypt',
      page: 1,
      pageCount: 20,
      hasMore: false,
      alerts: [
        {
          id: 'a-1',
          instrumentId: idFor('COMI'),
          ticker: 'COMI',
          targetPrice: 110,
          direction: 'UP',
          frequency: 'ONE_TIME',
          createdAt: '2026-01-01T09:00:00.000Z',
          currentPrice: 100,
        },
        {
          id: 'a-2',
          instrumentId: idFor('HRHO'),
          ticker: 'HRHO',
          targetPrice: 110,
          direction: null,
          frequency: 'ONE_TIME',
          createdAt: '2026-01-01T09:00:00.000Z',
          currentPrice: 101,
        },
      ],
    });
  });

  it('clamps paging and reports more pages', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: alerts(5) }));
    const uc = new GetAlerts(deps);
    const out = await uc.execute({ page: 2, pageCount: 2 });
    expect(out).toMatchObject({ page: 2, pageCount: 2, hasMore: true });
    expect(out.alerts.map((a) => a.id)).toEqual(['a-2', 'a-3']);
    await uc.execute({ page: 0, pageCount: 1000 });
    await uc.execute({ page: Number.NaN, pageCount: 2.7 });
    expect(deps.repository.calls.listPriceAlerts.slice(1)).toEqual([
      { market: 'egypt', page: 1, pageCount: 100 },
      { market: 'egypt', page: 1, pageCount: 2 },
    ]);
  });

  it('lists the alerts of one symbol', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({
        alerts: [anAlert(), anAlert({ id: 'h', ticker: 'HRHO', createdAt: null })],
      }),
    );
    const out = await new GetAlerts(deps).execute({ symbol: 'hrho' });
    expect(deps.repository.calls.listAlertsForInstrument).toEqual([idFor('HRHO')]);
    expect(out).toMatchObject({ page: 1, pageCount: 1, hasMore: false });
    expect(out.alerts).toEqual([expect.objectContaining({ id: 'h', ticker: 'HRHO', createdAt: null })]);
  });
});
