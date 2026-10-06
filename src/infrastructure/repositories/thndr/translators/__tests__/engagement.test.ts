import { describe, expect, it } from 'vitest';
import {
  toAlertDirection,
  toAlertFrequency,
  toAssetIds,
  toNotification,
  toPriceAlert,
  toWatchlist,
} from '../engagement';

const A = '1923d036-45ad-480b-8c6b-1d1296862f6e';
const B = 'b0a4c53e-b12f-4e93-b94b-759b8eeaef14';

describe('toAssetIds', () => {
  it('keeps valid UUIDs only', () => {
    expect(toAssetIds([A, 'nope', 3, null, B.toUpperCase()]).map((id) => id.value)).toEqual([A, B]);
    expect(toAssetIds(null)).toEqual([]);
    expect(toAssetIds('x')).toEqual([]);
  });
});

describe('toWatchlist', () => {
  it('maps a full row', () => {
    const w = toWatchlist({ id: 12, name: ' Banks ', color: 'color_4', icon: 'thndr', asset_ids: [A, B, A] });
    expect(w).toMatchObject({ id: '12', name: 'Banks', color: 'color_4', icon: 'thndr' });
    expect(w?.instrumentIds.map((i) => i.value)).toEqual([A, B]);
  });

  it('defaults unknown fields', () => {
    expect(toWatchlist({ id: 'x', name: '  ', color: '', asset_ids: null })).toEqual({
      id: 'x',
      name: '',
      color: null,
      icon: null,
      instrumentIds: [],
    });
  });

  it.each([null, undefined, 'x', {}, { id: ' ' }, { id: null }, { id: {} }])('rejects %j', (dto) => {
    expect(toWatchlist(dto as never)).toBeNull();
  });
});

describe('toPriceAlert', () => {
  it('maps a full row', () => {
    const alert = toPriceAlert({
      id: 42,
      asset_id: A,
      asset_symbol: 'comi',
      price: '110.5',
      frequency: 'recurring',
      direction: 'down',
      created_at: '2026-01-01T09:00:00Z',
    });
    expect(alert).toMatchObject({
      id: '42',
      targetPrice: 110.5,
      frequency: 'RECURRING',
      direction: 'DOWN',
      createdAt: new Date('2026-01-01T09:00:00Z'),
    });
    expect(alert?.ticker?.value).toBe('COMI');
    expect(alert?.instrumentId.value).toBe(A);
  });

  it('nulls unknown fields', () => {
    expect(
      toPriceAlert({
        id: 'a',
        asset_id: A,
        price: 1,
        frequency: 'DAILY',
        direction: 7 as never,
        asset_symbol: '',
      }),
    ).toMatchObject({ ticker: null, frequency: null, direction: null, createdAt: null });
  });

  it.each([
    null,
    'x',
    { asset_id: A, price: 1 },
    { id: 'a', asset_id: 'bad', price: 1 },
    { id: 'a', asset_id: A },
    { id: 'a', asset_id: A, price: 0 },
    { id: 'a', asset_id: A, price: 'abc' },
  ])('rejects %j', (dto) => {
    expect(toPriceAlert(dto as never)).toBeNull();
  });
});

describe('enum mappers', () => {
  it('maps directions and frequencies case-insensitively', () => {
    expect(toAlertDirection(' up ')).toBe('UP');
    expect(toAlertDirection(undefined)).toBeNull();
    expect(toAlertFrequency('ONE_TIME')).toBe('ONE_TIME');
    expect(toAlertFrequency('weekly')).toBeNull();
  });
});

describe('toNotification', () => {
  it('maps a full row', () => {
    expect(
      toNotification({
        id: 'n1',
        title: '🚀 Filled',
        text: 'Body',
        is_read: true,
        created_at: 1_767_225_600,
        type: 'order_completed',
        action: 'ignored',
      }),
    ).toEqual({
      id: 'n1',
      title: '🚀 Filled',
      text: 'Body',
      read: true,
      createdAt: new Date(1_767_225_600_000),
      type: 'order_completed',
    });
  });

  it('defaults unknown fields and falls back to the action as type', () => {
    expect(
      toNotification({ id: 5, title: 3 as never, is_read: 'yes' as never, action: 'price_alert_triggered' }),
    ).toEqual({ id: '5', title: '', text: '', read: false, createdAt: null, type: 'price_alert_triggered' });
    expect(toNotification({ id: 'n' })?.type).toBeNull();
  });

  it.each([null, 7, { title: 'x' }, { id: '' }])('rejects %j', (dto) => {
    expect(toNotification(dto as never)).toBeNull();
  });
});
