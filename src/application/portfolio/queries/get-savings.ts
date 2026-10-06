import type { SavingsBalances, SavingsYield } from '../../../domain/portfolio/savings';
import type { Currency } from '../../../domain/shared-kernel/money';
import { Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {};

export type SavingsResult = SavingsBalances & {
  currency: Currency;
  yields: SavingsYield[];
  note: string;
};

/** Savings ("Clouds") balances and product yields — read-only (ADR 0006). */
export class GetSavings extends Query<typeof input, SavingsResult> {
  readonly name = 'get_savings';
  readonly title = 'Savings (Clouds)';
  readonly description =
    'Thndr savings ("Clouds"): total amount and gain, each savings bundle (type, amount, gains, withdrawable ' +
    'amount), amounts per product type, and the current yield of each product (currently earning %, nominal ' +
    'yields by frequency). Read-only — this server cannot move money into or out of savings.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(): Promise<SavingsResult> {
    const [balances, yields] = await Promise.all([
      this.deps.repository.getSavings(),
      this.deps.repository.getSavingsYields(),
    ]);
    return {
      currency: 'EGP',
      ...balances,
      yields,
      note: 'Read-only: transfers into or out of savings are made in the Thndr app.',
    };
  }
}
