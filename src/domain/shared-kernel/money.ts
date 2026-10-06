import { ValidationError } from './errors';
import { assertFiniteNumber, roundTo } from './guards';

export const CURRENCIES = ['EGP', 'USD', 'AED'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Immutable monetary amount. Amounts are kept to 4 decimals (EGX prices go to 3). */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: Currency,
  ) {
    Object.freeze(this);
  }

  static of(amount: number, currency: Currency = 'EGP'): Money {
    assertFiniteNumber(amount, 'Money amount');
    if (!isCurrency(currency)) throw new ValidationError(`Unsupported currency: ${String(currency)}`);
    return new Money(roundTo(amount, 4), currency);
  }

  static zero(currency: Currency = 'EGP'): Money {
    return new Money(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount - other.amount, this.currency);
  }

  multiply(factor: number): Money {
    return Money.of(this.amount * factor, this.currency);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  toString(): string {
    return `${this.amount.toFixed(2)} ${this.currency}`;
  }

  toJSON(): { amount: number; currency: Currency } {
    return { amount: this.amount, currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new ValidationError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
