import type { ClosedTrade, JournalPage } from '../../../domain/portfolio/journal';
import { Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';
import { type JournalInput, journalInput, journalQuery } from '../journal-input';

/** Closed round-trip trades from the trading journal. */
export class GetClosedTrades extends Query<typeof journalInput, JournalPage<ClosedTrade>> {
  readonly name = 'get_closed_trades';
  readonly title = 'Closed trades (journal)';
  readonly description =
    'Trading journal of round trips: entry/exit dates and prices, volume, net P/L and holding period.';
  readonly context = 'portfolio';
  readonly input = journalInput;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: JournalInput): Promise<JournalPage<ClosedTrade>> {
    return this.deps.repository.getClosedTrades(journalQuery(params, this.deps.clock));
  }
}
