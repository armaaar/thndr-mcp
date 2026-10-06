import { assertFiniteNumber, roundTo } from '../shared-kernel/guards';
import type { Currency } from '../shared-kernel/money';

/** Raw cash and portfolio figures of one market account (ThndrX "wallet and portfolio"). */
export interface AccountSummaryInput {
  /** Cash usable for new buys ("Buying power", wire `purchase_power`). */
  readonly buyingPower: number;
  /** Cash reserved by open buy orders ("Blocked cash", wire `cash_in_holding`). */
  readonly blockedCash: number;
  /** Sale proceeds not settled yet. */
  readonly unsettledCash: number;
  readonly settledCash: number | null;
  /** Market value of all positions. */
  readonly portfolioValue: number;
  /** Unrealized return of the open positions, in the account currency. */
  readonly totalReturn: number | null;
  readonly totalReturnPercent: number | null;
  readonly currency: Currency;
}

export interface AccountSummary extends AccountSummaryInput {
  /** Withdrawable cash, as ThndrX computes it: `purchase_power - unsettled_cash`. */
  readonly availableCash: number;
  /** ThndrX total: `cash_in_holding + purchase_power + portfolio_value` (savings are not included). */
  readonly totalAccountValue: number;
}

export function createAccountSummary(input: AccountSummaryInput): AccountSummary {
  const { buyingPower, blockedCash, unsettledCash, portfolioValue } = input;
  for (const [label, value] of Object.entries({ buyingPower, blockedCash, unsettledCash, portfolioValue })) {
    assertFiniteNumber(value, `Account ${label}`);
  }
  for (const [label, value] of Object.entries({
    settledCash: input.settledCash,
    totalReturn: input.totalReturn,
    totalReturnPercent: input.totalReturnPercent,
  })) {
    if (value !== null) assertFiniteNumber(value, `Account ${label}`);
  }
  return Object.freeze({
    ...input,
    availableCash: roundTo(buyingPower - unsettledCash, 4),
    totalAccountValue: roundTo(blockedCash + buyingPower + portfolioValue, 4),
  });
}

/** Cash currency of a Thndr market account. */
export function accountCurrency(market: 'egypt' | 'us'): Currency {
  return market === 'us' ? 'USD' : 'EGP';
}
