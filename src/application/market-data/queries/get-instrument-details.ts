import type { Instrument } from '../../../domain/market-data/instrument';
import { marketSupports, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { dataMarket } from '../services/snapshot-market';

const input = { symbol: symbolInput, market: marketInput };

export type InstrumentDetails = Instrument & {
  /**
   * Symbols of the indices the instrument belongs to; null when membership could not be loaded or the instrument's
   * market has no index membership (Thndr publishes it only for Egypt).
   */
  indices: string[] | null;
};

export class GetInstrumentDetails extends Query<typeof input, InstrumentDetails> {
  readonly name = 'get_instrument_details';
  readonly title = 'Instrument details';
  readonly description =
    'All markets: company profile and listing details for one instrument — name, sector (industry), board, ' +
    'currency, tradability, suspension, description and Thndr\'s tags (e.g. sector, "EGX30 Index", "Same Day ' +
    'Tradable", "Tech"). Egypt only: the indices it belongs to (EGX30, SHARIAH…); `indices` is null elsewhere.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<InstrumentDetails> {
    const market = parseMarket(params.market);
    const resolved = await this.deps.resolver.resolve(params.symbol, market);
    // Index membership exists only for markets with indices (Egypt); never ask Thndr for the others.
    const home = dataMarket(resolved.market);
    const withIndices = marketSupports(home, 'indices');
    const [instrument, membership] = await Promise.all([
      this.deps.repository.getInstrument(resolved.id),
      // Membership only enriches the answer: tolerate failures.
      withIndices ? this.deps.indices.membership(home).catch(() => null) : Promise.resolve(null),
    ]);
    const indices = membership ? (membership.get(instrument.id.value) ?? []) : null;
    return { ...instrument, indices };
  }
}
