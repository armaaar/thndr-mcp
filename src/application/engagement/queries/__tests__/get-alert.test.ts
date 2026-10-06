import { describe, expect, it } from 'vitest';
import {
  anAlert,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { NotFoundError } from '../../../errors';
import { ALERT_SCAN_MAX_PAGES, ALERT_SCAN_PAGE_SIZE } from '../../constants';
import { GetAlert } from '../get-alert';

function alerts(n: number) {
  return Array.from({ length: n }, (_, i) => anAlert({ id: `a-${i}`, targetPrice: 100 + i }));
}

describe('GetAlert contract', () => {
  const uc = new GetAlert(engagementSetup());

  it('is the get_alert query', () => {
    expect(uc).toMatchObject({ name: 'get_alert', kind: 'query', context: 'engagement' });
    expect(Object.keys(uc.input)).toEqual(['id', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'a-1', symbol: 'COMI' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults the market to egypt', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    expect((await new GetAlert(deps).run({ id: 'a-1' })).id).toBe('a-1');
    expect(deps.repository.calls.listPriceAlerts[0]?.market).toBe('egypt');
  });
});

describe('GetAlert', () => {
  it('scans pages until it finds the id', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: alerts(ALERT_SCAN_PAGE_SIZE + 3) }));
    const out = await new GetAlert(deps).execute({ id: `a-${ALERT_SCAN_PAGE_SIZE + 1}` });
    expect(out.id).toBe(`a-${ALERT_SCAN_PAGE_SIZE + 1}`);
    expect(deps.repository.calls.listPriceAlerts.map((c) => c.page)).toEqual([1, 2]);
  });

  it('stops at a short page', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: alerts(3) }));
    await expect(new GetAlert(deps).execute({ id: 'zzz', market: 'us' })).rejects.toThrow(
      'No us price alert with id zzz',
    );
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(1);
  });

  it('caps the number of pages scanned', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ alerts: alerts(ALERT_SCAN_PAGE_SIZE * (ALERT_SCAN_MAX_PAGES + 1)) }),
    );
    await expect(new GetAlert(deps).execute({ id: 'zzz' })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(ALERT_SCAN_MAX_PAGES);
  });

  it('validates the id', async () => {
    await expect(new GetAlert(engagementSetup()).execute({ id: '' })).rejects.toThrow(
      'Alert id must not be empty',
    );
  });
});
