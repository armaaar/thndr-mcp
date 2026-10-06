import type { Ticker } from '../shared/ticker.js';

/** Coarse grouping of Thndr's account activity types, for filtering and summaries. */
export const ACTIVITY_CATEGORIES = [
  'TRADE',
  'DEPOSIT',
  'WITHDRAWAL',
  'DIVIDEND',
  'FEE',
  'TRANSFER',
  'REWARD',
  'OTHER',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

const CATEGORY_BY_TYPE: Record<string, ActivityCategory> = {
  BUY_ORDER: 'TRADE',
  SELL_ORDER: 'TRADE',
  SUBSCRIBE_ORDER: 'TRADE',
  ACCOUNT_DEPOSIT_FUND: 'DEPOSIT',
  ACCOUNT_WITHDRAW_FUND: 'WITHDRAWAL',
  DIVIDEND: 'DIVIDEND',
  DIVIDEND_NRA: 'DIVIDEND',
  BANK_FEES: 'FEE',
  SUBSCRIPTION_FEES: 'FEE',
  SETTLEMENT_FEES: 'FEE',
  CASH_DEDUCTION: 'FEE',
  WALLET_TRANSFER: 'TRANSFER',
  TO_SAVINGS: 'TRANSFER',
  FROM_SAVINGS: 'TRANSFER',
  GIFT_CARD_IN: 'TRANSFER',
  GIFT_CARD_OUT: 'TRANSFER',
  REWARD: 'REWARD',
  MONTHLY_INCENTIVE: 'REWARD',
  COMMISSION_KICKBACK: 'REWARD',
};

export function categorizeActivity(type: string): ActivityCategory {
  return CATEGORY_BY_TYPE[type.toUpperCase()] ?? 'OTHER';
}

/** One row of the account statement (cash movements, executions, fees, dividends…). */
export interface AccountActivity {
  readonly id: string;
  /** Thndr activity type, upper-case (`BUY_ORDER`, `DIVIDEND`, `BANK_FEES`, …). */
  readonly type: string;
  readonly category: ActivityCategory;
  /** Signed amount in the account currency, as Thndr reports it. */
  readonly amount: number | null;
  readonly createdAt: Date | null;
  readonly description: string | null;
  readonly ticker: Ticker | null;
}

export function createAccountActivity(input: Omit<AccountActivity, 'category'>): AccountActivity {
  const type = input.type.toUpperCase();
  return Object.freeze({ ...input, type, category: categorizeActivity(type) });
}

export interface ActivityPage {
  readonly activities: readonly AccountActivity[];
  readonly page: number;
  readonly hasMore: boolean;
}
