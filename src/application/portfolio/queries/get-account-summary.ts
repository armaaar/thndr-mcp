import { type Market, parseMarket } from '../../../domain/market-data/market';
import type { AccountSummary } from '../../../domain/portfolio/account-summary';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = { market: marketInput };

export type AccountSummaryResult = AccountSummary & { market: Market; positions: number };

export class GetAccountSummary extends Query<typeof input, AccountSummaryResult> {
  readonly name = 'get_account_summary';
  readonly title = 'Account summary';
  readonly description =
    'Cash and value of the Thndr account: buying power, blocked cash (reserved by open buy orders), unsettled ' +
    'cash, available cash, portfolio market value, total return and total account value.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<AccountSummaryResult> {
    const market = parseMarket(params.market);
    const { summary, positions } = await this.deps.repository.getAccount(market);
    return { market, ...summary, positions: positions.length };
  }
}
