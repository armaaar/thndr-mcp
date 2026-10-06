import { describe, expect, it } from 'vitest';
import {
  anAlert,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { NotFoundError, UpstreamError } from '../../../errors';
import { UpdateAlert } from '../update-alert';

describe('UpdateAlert contract', () => {
  const uc = new UpdateAlert(engagementSetup());

  it('is the update_alert command, neither destructive nor idempotent', () => {
    expect(uc).toMatchObject({
      name: 'update_alert',
      kind: 'command',
      context: 'engagement',
      destructive: false,
      idempotent: false,
    });
    expect(Object.keys(uc.input)).toEqual(['id', 'price', 'direction', 'frequency', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'a-1', price: 1, symbol: 'COMI' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ id: 'a-1', price: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: 'a-1', direction: 'SIDEWAYS' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('defaults the market to egypt', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    await new UpdateAlert(deps).run({ id: 'a-1', frequency: 'RECURRING' });
    expect(deps.repository.calls.listPriceAlerts[0]?.market).toBe('egypt');
    expect(deps.repository.calls.createPriceAlert[0]?.market).toBe('egypt');
  });
});

describe('UpdateAlert', () => {
  it('deletes then re-creates with a new price, re-deriving the direction', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ alerts: [anAlert({ targetPrice: 110, direction: 'UP' })] }),
    );
    const out = await new UpdateAlert(deps).execute({ id: 'a-1', price: 90 });
    expect(deps.repository.calls.deletePriceAlert).toEqual(['a-1']);
    expect(deps.repository.calls.createPriceAlert).toEqual([
      { instrumentId: idFor('COMI'), price: 90, direction: 'DOWN', frequency: 'ONE_TIME', market: 'egypt' },
    ]);
    expect(out).toMatchObject({ id: 'a-100', previousId: 'a-1', targetPrice: 90, direction: 'DOWN' });
  });

  it('keeps price and direction when only the frequency changes', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert({ direction: 'DOWN' })] }));
    await new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'RECURRING' });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      price: 110,
      direction: 'DOWN',
      frequency: 'RECURRING',
    });
  });

  it('keeps the direction when the same price is passed', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ alerts: [anAlert({ direction: 'DOWN', frequency: null })] }),
    );
    await new UpdateAlert(deps).execute({ id: 'a-1', price: 110 });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      direction: 'DOWN',
      frequency: 'ONE_TIME',
    });
  });

  it('derives a missing direction and honours an explicit one', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert({ direction: null })] }));
    await new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'once' as never });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({ direction: 'UP' });
    await new UpdateAlert(deps).execute({ id: 'a-100', direction: 'down' as never, price: 120 });
    expect(deps.repository.calls.createPriceAlert[1]).toMatchObject({ direction: 'DOWN', price: 120 });
  });

  it('refuses to derive without a quote, naming the instrument id when the ticker is unknown', async () => {
    const deps = engagementSetup(
      new FakeEngagementRepository({ alerts: [anAlert({ ticker: null, instrumentId: idFor('NOQUOTE') })] }),
    );
    await expect(new UpdateAlert(deps).execute({ id: 'a-1', price: 5 })).rejects.toThrow(
      `No current price for ${idFor('NOQUOTE')}`,
    );
    expect(deps.repository.calls.deletePriceAlert).toEqual([]);
  });

  it('validates input before touching upstream', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    const uc = new UpdateAlert(deps);
    await expect(uc.execute({ id: 'a-1' })).rejects.toThrow('Nothing to change');
    await expect(uc.execute({ id: 'a-1', price: 0 })).rejects.toThrow('greater than zero');
    await expect(uc.execute({ id: ' ', price: 1 })).rejects.toThrow('Alert id must not be empty');
    await expect(uc.execute({ id: 'missing', price: 1 })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(1);
  });

  it('restores the original alert when re-creation fails', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [anAlert({ direction: null, frequency: null })],
    });
    repository.failOnCall.createPriceAlert = { call: 1, error: new Error('rejected') };
    const deps = engagementSetup(repository);
    const error = await new UpdateAlert(deps).execute({ id: 'a-1', price: 90 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe(
      'Could not re-create alert a-1 with the new values (rejected). The original alert was restored (with a new id).',
    );
    expect(repository.calls.createPriceAlert[1]).toEqual({
      instrumentId: idFor('COMI'),
      price: 110,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      market: 'egypt',
    });
  });

  it('reports when the original alert cannot be restored', async () => {
    const repository = new FakeEngagementRepository({ alerts: [anAlert()] });
    repository.failures.createPriceAlert = 'nope' as unknown as Error;
    const deps = engagementSetup(repository);
    await expect(new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'RECURRING' })).rejects.toThrow(
      'Could not re-create alert a-1 with the new values (nope). The original alert could not be restored',
    );
    expect(repository.calls.createPriceAlert).toEqual([
      expect.objectContaining({ frequency: 'RECURRING', direction: 'UP' }),
      expect.objectContaining({ frequency: 'ONE_TIME', direction: 'UP' }),
    ]);
  });
});
