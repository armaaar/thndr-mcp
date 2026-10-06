import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/domain/shared-kernel/money';
import { Ticker } from '../../../src/domain/shared-kernel/ticker';
import { isRecord, toView } from '../../../src/presentation/presenters/view';

describe('toView', () => {
  it('collapses value objects through toJSON and dates to ISO-8601 strings', () => {
    const view = toView({
      ticker: Ticker.of('comi'),
      price: Money.of(80.5),
      at: new Date('2026-03-01T10:00:00Z'),
    });
    expect(view).toEqual({
      ticker: 'COMI',
      price: { amount: 80.5, currency: 'EGP' },
      at: '2026-03-01T10:00:00.000Z',
    });
  });

  it('maps a missing result to null and drops undefined fields', () => {
    expect(toView(undefined)).toBeNull();
    expect(toView({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps scalars and arrays (undefined array items become null)', () => {
    expect(toView(3)).toBe(3);
    expect(toView('x')).toBe('x');
    expect(toView(null)).toBeNull();
    expect(toView([1, undefined, Ticker.of('HRHO')])).toEqual([1, null, 'HRHO']);
  });

  it('returns a detached copy', () => {
    const source = { nested: { a: 1 } };
    const view = toView(source) as { nested: { a: number } };
    view.nested.a = 2;
    expect(source.nested.a).toBe(1);
  });
});

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});
