import { describe, expect, it } from 'vitest';
import { accountCurrency, createAccountSummary } from '../../../src/domain/portfolio/account-summary.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';

const base = {
  buyingPower: 10_000.1,
  blockedCash: 500.2,
  unsettledCash: 1_000,
  settledCash: 9_000,
  portfolioValue: 25_000.3,
  totalReturn: 1_200,
  totalReturnPercent: 5.04,
  currency: 'EGP' as const,
};

describe('createAccountSummary', () => {
  it('derives available cash and total account value with ThndrX formulas', () => {
    const summary = createAccountSummary(base);
    expect(summary.availableCash).toBe(9_000.1);
    expect(summary.totalAccountValue).toBe(35_500.6);
    expect(summary.buyingPower).toBe(10_000.1);
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it('accepts unknown optional figures', () => {
    const summary = createAccountSummary({
      ...base,
      settledCash: null,
      totalReturn: null,
      totalReturnPercent: null,
    });
    expect(summary.settledCash).toBeNull();
    expect(summary.totalReturn).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(() => createAccountSummary({ ...base, buyingPower: Number.NaN })).toThrow(ValidationError);
    expect(() => createAccountSummary({ ...base, totalReturn: Number.POSITIVE_INFINITY })).toThrow(
      /totalReturn/,
    );
  });
});

describe('accountCurrency', () => {
  it('maps markets to their cash currency', () => {
    expect(accountCurrency('egypt')).toBe('EGP');
    expect(accountCurrency('us')).toBe('USD');
  });
});
