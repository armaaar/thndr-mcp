import { describe, expect, it } from 'vitest';
import { AssetId } from '../../shared-kernel/asset-id';
import { ValidationError } from '../../shared-kernel/errors';
import { Ticker } from '../../shared-kernel/ticker';
import {
  createPriceAlert,
  DEFAULT_ALERT_FREQUENCY,
  deriveAlertDirection,
  parseAlertDirection,
  parseAlertFrequency,
} from '../price-alert';

const ID = AssetId.of('1923d036-45ad-480b-8c6b-1d1296862f6e');

describe('createPriceAlert', () => {
  it('builds a frozen alert with defaults', () => {
    const alert = createPriceAlert({ id: ' 7 ', instrumentId: ID, targetPrice: 10.5 });
    expect(alert).toEqual({
      id: '7',
      instrumentId: ID,
      ticker: null,
      targetPrice: 10.5,
      direction: null,
      frequency: null,
      createdAt: null,
    });
    expect(Object.isFrozen(alert)).toBe(true);
  });

  it('copies the creation date and keeps every field', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const alert = createPriceAlert({
      id: 'a',
      instrumentId: ID,
      ticker: Ticker.of('COMI'),
      targetPrice: 1,
      direction: 'DOWN',
      frequency: 'RECURRING',
      createdAt,
    });
    expect(alert.createdAt).toEqual(createdAt);
    expect(alert.createdAt).not.toBe(createdAt);
    expect(alert).toMatchObject({ direction: 'DOWN', frequency: 'RECURRING' });
    expect(alert.ticker?.value).toBe('COMI');
  });

  it('drops an invalid creation date', () => {
    expect(
      createPriceAlert({ id: 'a', instrumentId: ID, targetPrice: 1, createdAt: new Date('nope') }).createdAt,
    ).toBeNull();
  });

  it('rejects empty ids and non-positive prices', () => {
    expect(() => createPriceAlert({ id: ' ', instrumentId: ID, targetPrice: 1 })).toThrow(
      'Price alert id must not be empty',
    );
    expect(() => createPriceAlert({ id: 3 as unknown as string, instrumentId: ID, targetPrice: 1 })).toThrow(
      ValidationError,
    );
    expect(() => createPriceAlert({ id: 'a', instrumentId: ID, targetPrice: 0 })).toThrow(
      'greater than zero',
    );
  });
});

describe('deriveAlertDirection', () => {
  it('is DOWN below the current price and UP otherwise', () => {
    expect(deriveAlertDirection(9, 10)).toBe('DOWN');
    expect(deriveAlertDirection(10, 10)).toBe('UP');
    expect(deriveAlertDirection(11, 10)).toBe('UP');
  });

  it('rejects non-positive prices', () => {
    expect(() => deriveAlertDirection(0, 10)).toThrow(ValidationError);
    expect(() => deriveAlertDirection(10, Number.NaN)).toThrow('Current price');
  });
});

describe('parseAlertDirection', () => {
  it.each([
    ['up', 'UP'],
    [' Above ', 'UP'],
    ['DOWN', 'DOWN'],
    ['below', 'DOWN'],
    [undefined, null],
    [null, null],
    ['  ', null],
  ])('%j → %j', (raw, expected) => {
    expect(parseAlertDirection(raw)).toBe(expected);
  });

  it('rejects unknown values', () => {
    expect(() => parseAlertDirection('sideways')).toThrow('Invalid alert direction "sideways"');
  });
});

describe('parseAlertFrequency', () => {
  it.each([
    ['one_time', 'ONE_TIME'],
    ['one-time', 'ONE_TIME'],
    ['One Time', 'ONE_TIME'],
    ['once', 'ONE_TIME'],
    ['recurring', 'RECURRING'],
    ['repeat', 'RECURRING'],
    [undefined, null],
    [null, null],
    ['', null],
  ])('%j → %j', (raw, expected) => {
    expect(parseAlertFrequency(raw)).toBe(expected);
  });

  it('rejects unknown values and defaults to ONE_TIME', () => {
    expect(() => parseAlertFrequency('daily')).toThrow('Invalid alert frequency "daily"');
    expect(DEFAULT_ALERT_FREQUENCY).toBe('ONE_TIME');
  });
});
