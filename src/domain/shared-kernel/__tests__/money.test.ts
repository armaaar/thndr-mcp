import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { isCurrency, Money } from '../money';

describe('Money', () => {
  it('defaults to EGP and rounds away float artefacts', () => {
    const m = Money.of(0.1).add(Money.of(0.2));
    expect(m.amount).toBe(0.3);
    expect(m.currency).toBe('EGP');
    expect(m.toString()).toBe('0.30 EGP');
    expect(m.toJSON()).toEqual({ amount: 0.3, currency: 'EGP' });
  });

  it('supports arithmetic and comparison', () => {
    const a = Money.of(10, 'USD');
    const b = Money.of(4, 'USD');
    expect(a.subtract(b).amount).toBe(6);
    expect(b.multiply(2.5).amount).toBe(10);
    expect(a.isGreaterThan(b)).toBe(true);
    expect(b.isGreaterThan(a)).toBe(false);
    expect(a.equals(Money.of(10, 'USD'))).toBe(true);
    expect(a.equals(Money.of(10, 'EGP'))).toBe(false);
    expect(Money.zero().amount).toBe(0);
    expect(Money.zero('USD').currency).toBe('USD');
  });

  it('is immutable', () => {
    const m = Money.of(1);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(() => Money.of(Number.NaN)).toThrow(ValidationError);
    expect(() => Money.of(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
    expect(() => Money.of(1, 'GBP' as never)).toThrow(/Unsupported currency/);
    expect(() => Money.of(1).add(Money.of(1, 'USD'))).toThrow(/Currency mismatch/);
  });

  it('recognises currencies', () => {
    expect(isCurrency('EGP')).toBe(true);
    expect(isCurrency('GBP')).toBe(false);
  });
});
