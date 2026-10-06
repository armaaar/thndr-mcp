/**
 * Savings ("Clouds"): money the user parked in Thndr's savings products, seen read-only. thndr-mcp never transfers
 * money into or out of savings (ADR 0006).
 */

/** One savings bundle ("cloud") of the user. */
export interface SavingsCloud {
  readonly id: string | null;
  readonly name: string | null;
  /** Product, e.g. `INSTANT_EGP` or `MONTHLY_EGP`. */
  readonly type: string | null;
  readonly amount: number | null;
  readonly gains: number | null;
  readonly withdrawableAmount: number | null;
}

/** Savings balances of the user (EGP). */
export interface SavingsBalances {
  readonly totalAmount: number | null;
  readonly totalGain: number | null;
  readonly count: number | null;
  /** Amount per product type, as Thndr sends it. */
  readonly amountsPerType: Readonly<Record<string, number>>;
  readonly clouds: readonly SavingsCloud[];
}

/** Annualised nominal yields (percent) by compounding/payout frequency. */
export interface NominalYields {
  readonly daily: number | null;
  readonly weekly: number | null;
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly semiAnnually: number | null;
}

/** Current yield of one savings product. */
export interface SavingsYield {
  readonly product: string;
  /** Yield currently earned, in percent per year. */
  readonly currentlyEarningPercent: number | null;
  /** As Thndr sends it (no time zone given). */
  readonly lastUpdatedAt: string | null;
  readonly nominalYieldsPercent: NominalYields;
}
