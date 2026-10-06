import { describe, expect, it } from 'vitest';
import {
  anAlert,
  engagementMarket,
  engagementSetup,
  FakeEngagementRepository,
} from '../../../../__tests__/support/fake-engagement';
import { aQuote, idFor } from '../../../../__tests__/support/fake-market-data';
import { ValidationError } from '../../../../domain/shared-kernel/errors';
import { CreateAlert } from '../create-alert';

describe('CreateAlert contract', () => {
  const uc = new CreateAlert(engagementSetup());

  it('is the create_alert command, neither destructive nor idempotent', () => {
    expect(uc).toMatchObject({
      name: 'create_alert',
      kind: 'command',
      context: 'engagement',
      destructive: false,
      idempotent: false,
    });
    expect(Object.keys(uc.input)).toEqual(['symbol', 'price', 'direction', 'frequency', 'market']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ symbol: 'COMI', price: 1, extra: 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ symbol: 'COMI', price: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', price: 1, direction: 'below' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ symbol: 'COMI', price: 1, frequency: 'x' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('defaults to a derived direction, ONE_TIME, on egypt', async () => {
    const deps = engagementSetup();
    await new CreateAlert(deps).run({ symbol: 'COMI', price: 95 });
    expect(deps.repository.calls.createPriceAlert).toEqual([
      { instrumentId: idFor('COMI'), price: 95, direction: 'DOWN', frequency: 'ONE_TIME', market: 'egypt' },
    ]);
  });
});

describe('CreateAlert', () => {
  it('derives DOWN below the last price and defaults to ONE_TIME', async () => {
    const deps = engagementSetup();
    const out = await new CreateAlert(deps).execute({ symbol: 'comi', price: 95 });
    expect(deps.repository.calls.createPriceAlert).toEqual([
      { instrumentId: idFor('COMI'), price: 95, direction: 'DOWN', frequency: 'ONE_TIME', market: 'egypt' },
    ]);
    expect(out).toEqual({
      id: 'a-100',
      instrumentId: idFor('COMI'),
      ticker: 'COMI',
      targetPrice: 95,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      createdAt: '2026-01-15T12:00:00.000Z',
      currentPrice: 100,
    });
  });

  it('derives UP at or above the last price', async () => {
    const deps = engagementSetup();
    await new CreateAlert(deps).execute({ symbol: 'COMI', price: 100, frequency: 'recurring' as never });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      direction: 'UP',
      frequency: 'RECURRING',
    });
  });

  it('honours an explicit direction without a quote lookup', async () => {
    const deps = engagementSetup();
    await new CreateAlert(deps).execute({ symbol: 'EGX30', price: 30_000, direction: 'below' as never });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({ direction: 'DOWN' });
  });

  it('requires a direction when there is no current price', async () => {
    const market = engagementMarket();
    market.quotes.egypt = [aQuote({ ticker: 'COMI', last: 0 })];
    const deps = engagementSetup(new FakeEngagementRepository(), market);
    const uc = new CreateAlert(deps);
    await expect(uc.execute({ symbol: 'EGX30', price: 1 })).rejects.toThrow(
      'No current price for EGX30, so the alert direction cannot be derived',
    );
    await expect(uc.execute({ symbol: 'COMI', price: 1 })).rejects.toThrow(ValidationError);
    expect(deps.repository.calls.createPriceAlert).toEqual([]);
  });

  it('validates price, direction and frequency before resolving', async () => {
    const deps = engagementSetup();
    const uc = new CreateAlert(deps);
    await expect(uc.execute({ symbol: 'COMI', price: -1 })).rejects.toThrow('greater than zero');
    await expect(uc.execute({ symbol: 'COMI', price: 1, direction: 'x' as never })).rejects.toThrow(
      'direction',
    );
    await expect(uc.execute({ symbol: 'COMI', price: 1, frequency: 'x' as never })).rejects.toThrow(
      'frequency',
    );
    expect(deps.market.calls.searchInstruments).toEqual([]);
  });

  it('finds the created alert in the asset list when the reply is opaque', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [
        anAlert({ id: 'old', targetPrice: 95, direction: 'UP' }),
        anAlert({ id: 'srv', targetPrice: 95, direction: null, frequency: null }),
      ],
    });
    repository.createReturnsAlert = false;
    const deps = engagementSetup(repository);
    const out = await new CreateAlert(deps).execute({ symbol: 'COMI', price: 95, direction: 'DOWN' });
    expect(out.id).toBe('srv');
    expect(repository.calls.listAlertsForInstrument).toEqual([idFor('COMI')]);
  });

  it('matches on direction and frequency when known', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [anAlert({ id: 'recurring', targetPrice: 95, direction: 'DOWN', frequency: 'RECURRING' })],
    });
    repository.createReturnsAlert = false;
    const out = await new CreateAlert(engagementSetup(repository)).execute({
      symbol: 'COMI',
      price: 95,
      direction: 'DOWN',
    });
    // The fake also stored the new alert (a-100), which matches exactly.
    expect(out.id).toBe('a-100');
  });

  it('returns a null id when the alert cannot be identified', async () => {
    const repository = new FakeEngagementRepository();
    repository.createReturnsAlert = false;
    repository.failures.listAlertsForInstrument = new Error('down');
    const out = await new CreateAlert(engagementSetup(repository)).execute({ symbol: 'HRHO', price: 50 });
    expect(out).toEqual({
      id: null,
      instrumentId: idFor('HRHO'),
      ticker: 'HRHO',
      targetPrice: 50,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      createdAt: null,
      currentPrice: 101,
    });
  });
});
