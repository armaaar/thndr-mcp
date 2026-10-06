import type { Instrument } from '../../../domain/market-data/instrument';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { symbol: symbolInput, market: marketInput };

export type InstrumentDetails = Instrument & {
  /** Symbols of the indices the instrument belongs to; null when membership could not be loaded. */
  indices: string[] | null;
};

export class GetInstrumentDetails extends Query<typeof input, InstrumentDetails> {
  readonly name = 'get_instrument_details';
  readonly title = 'Instrument details';
  readonly description =
    'Company profile and listing details for one instrument: name, sector, board, currency, tradability, ' +
    'suspension, description, Thndr\'s tags (e.g. sector, "EGX30 Index", "Same Day Tradable") and the indices it ' +
    'belongs to (EGX30, SHARIAH…).';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<InstrumentDetails> {
    const market = parseMarket(params.market);
    const resolved = await this.deps.resolver.resolve(params.symbol, market);
    const [instrument, membership] = await Promise.all([
      this.deps.repository.getInstrument(resolved.id),
      // Membership only enriches the answer: tolerate failures.
      this.deps.indices.membership(market).catch(() => null),
    ]);
    const indices = membership ? (membership.get(instrument.id.value) ?? []) : null;
    return { ...instrument, indices };
  }
}
