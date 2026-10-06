import type { JournalPage, SellJournalEntry } from '../../../domain/portfolio/journal';
import { Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';
import { type JournalInput, journalInput, journalQuery } from '../journal-input';

/** Individual (possibly partial) sells with their realized P/L. */
export class GetSellJournal extends Query<typeof journalInput, JournalPage<SellJournalEntry>> {
  readonly name = 'get_sell_journal';
  readonly title = 'Sell journal';
  readonly description = 'Each sell execution with exit price, volume, average entry price and net P/L.';
  readonly context = 'portfolio';
  readonly input = journalInput;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: JournalInput): Promise<JournalPage<SellJournalEntry>> {
    return this.deps.repository.getSellJournal(journalQuery(params, this.deps.clock));
  }
}
