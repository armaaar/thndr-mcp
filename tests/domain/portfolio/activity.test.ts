import { describe, expect, it } from 'vitest';
import { categorizeActivity, createAccountActivity } from '../../../src/domain/portfolio/activity.js';

describe('categorizeActivity', () => {
  it.each([
    ['BUY_ORDER', 'TRADE'],
    ['sell_order', 'TRADE'],
    ['ACCOUNT_DEPOSIT_FUND', 'DEPOSIT'],
    ['ACCOUNT_WITHDRAW_FUND', 'WITHDRAWAL'],
    ['DIVIDEND_NRA', 'DIVIDEND'],
    ['SETTLEMENT_FEES', 'FEE'],
    ['TO_SAVINGS', 'TRANSFER'],
    ['COMMISSION_KICKBACK', 'REWARD'],
    ['SOMETHING_NEW', 'OTHER'],
  ])('%s → %s', (type, category) => {
    expect(categorizeActivity(type)).toBe(category);
  });
});

describe('createAccountActivity', () => {
  it('upper-cases the type and attaches its category', () => {
    const a = createAccountActivity({
      id: '1',
      type: 'dividend',
      amount: 12.5,
      createdAt: null,
      description: 'Dividend',
      ticker: null,
    });
    expect(a).toMatchObject({ type: 'DIVIDEND', category: 'DIVIDEND' });
    expect(Object.isFrozen(a)).toBe(true);
  });
});
