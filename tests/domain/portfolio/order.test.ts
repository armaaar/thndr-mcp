import { describe, expect, it } from 'vitest';
import {
  createOrder,
  isOpenOrderStatus,
  type OrderInput,
  parseOrderStatusFilter,
} from '../../../src/domain/portfolio/order';
import { ValidationError } from '../../../src/domain/shared-kernel/errors';
import { Ticker } from '../../../src/domain/shared-kernel/ticker';

function input(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    id: '42',
    instrumentId: null,
    ticker: Ticker.of('COMI'),
    side: 'BUY',
    type: 'LIMIT',
    quantity: 100,
    filledQuantity: null,
    price: 80,
    limitPrice: null,
    status: 'pending',
    statusDetail: 'pending',
    timeInForce: 'DAY',
    expiresAt: null,
    executionType: null,
    settlement: null,
    orderClass: null,
    brackets: [],
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: null,
    ...overrides,
  };
}

describe('createOrder', () => {
  it('normalises statuses and marks working orders open', () => {
    const o = createOrder(input());
    expect(o.status).toBe('PENDING');
    expect(o.statusDetail).toBe('PENDING');
    expect(o.isOpen).toBe(true);
    expect(o.remainingQuantity).toBe(100);
    expect(o.price).toBe(80);
    expect(o.averageFillPrice).toBeNull();
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.brackets)).toBe(true);
  });

  it('applies ThndrX price helpers to partially filled limit orders', () => {
    const o = createOrder(
      input({ statusDetail: 'PARTIALLY_FILLED', filledQuantity: 40, price: 79.5, limitPrice: 80 }),
    );
    expect(o.price).toBe(80);
    expect(o.averageFillPrice).toBe(79.5);
    expect(o.remainingQuantity).toBe(60);
    const same = createOrder(
      input({ statusDetail: 'PARTIALLY_FILLED', filledQuantity: 40, price: 80.0001, limitPrice: 80 }),
    );
    expect(same.averageFillPrice).toBeNull();
    const noLimit = createOrder(input({ statusDetail: 'PARTIALLY_FILLED', price: 79 }));
    expect(noLimit.price).toBe(79);
    const noPrice = createOrder(input({ statusDetail: 'PARTIALLY_FILLED', price: null, limitPrice: 80 }));
    expect(noPrice.averageFillPrice).toBeNull();
  });

  it('treats fulfilled and closed orders as done', () => {
    const o = createOrder(
      input({
        status: 'COMPLETED',
        statusDetail: 'FULFILLED',
        expiresAt: new Date('2026-01-02T00:00:00Z'),
        updatedAt: new Date('2026-01-01T11:00:00Z'),
      }),
    );
    expect(o.isOpen).toBe(false);
    expect(o.filledQuantity).toBe(100);
    expect(o.remainingQuantity).toBe(0);
    expect(o.expiresAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(o.updatedAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    const cancelled = createOrder(input({ status: 'CLOSED', statusDetail: null, createdAt: null }));
    expect(cancelled.isOpen).toBe(false);
    expect(cancelled.filledQuantity).toBeNull();
    expect(cancelled.createdAt).toBeNull();
  });

  it('uses the fine status when the coarse one is not an open status', () => {
    expect(createOrder(input({ status: 'X', statusDetail: 'PENDING_REPLACE' })).isOpen).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(() => createOrder(input({ id: '' }))).toThrow(ValidationError);
    expect(() => createOrder(input({ side: 'HOLD' as never }))).toThrow(/side/);
    expect(() => createOrder(input({ quantity: -1 }))).toThrow(/negative/);
    expect(() => createOrder(input({ quantity: Number.NaN }))).toThrow(ValidationError);
  });
});

describe('isOpenOrderStatus', () => {
  it('recognises open statuses case-insensitively', () => {
    expect(isOpenOrderStatus('queued_submit')).toBe(true);
    expect(isOpenOrderStatus('FULFILLED')).toBe(false);
    expect(isOpenOrderStatus(null)).toBe(false);
    expect(isOpenOrderStatus(undefined)).toBe(false);
  });
});

describe('parseOrderStatusFilter', () => {
  it.each([
    [undefined, 'all'],
    [null, 'all'],
    ['', 'all'],
    ['Pending', 'open'],
    ['filled', 'completed'],
    ['canceled', 'cancelled'],
    ['past', 'closed'],
  ])('parses %j', (raw, expected) => {
    expect(parseOrderStatusFilter(raw)).toBe(expected);
  });

  it('rejects unknown filters', () => {
    expect(() => parseOrderStatusFilter('weird')).toThrow(/Unsupported order status/);
  });
});
