import { z } from 'zod';
import type { Instrument } from '../../../domain/market-data/instrument';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = {
  query: z.string().min(1).describe('Ticker or company name'),
  market: marketInput,
  limit: z.number().int().min(1).max(50).default(20),
};

export class SearchInstruments extends Query<typeof input, { results: Instrument[] }> {
  readonly name = 'search_instruments';
  readonly title = 'Search instruments';
  readonly description =
    'Search stocks, ETFs, funds and indices by ticker or company name (English or Arabic). Returns tickers and ' +
    'Thndr asset ids. Call this first when you only know a company name.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<{ results: Instrument[] }> {
    const query = assertNonEmpty(params.query, 'Search query');
    const results = await this.deps.repository.searchInstruments(query, parseMarket(params.market));
    for (const instrument of results) this.deps.resolver.remember(instrument);
    return { results: results.slice(0, Math.min(Math.max(params.limit ?? 20, 1), 50)) };
  }
}
