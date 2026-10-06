import type { Instrument } from '../../../domain/market-data/instrument';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { symbol: symbolInput, market: marketInput };

export class GetInstrumentDetails extends Query<typeof input, Instrument> {
  readonly name = 'get_instrument_details';
  readonly title = 'Instrument details';
  readonly description =
    'Company profile and listing details for one instrument: name, sector, board, currency, tradability, suspension.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Instrument> {
    const resolved = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    return this.deps.repository.getInstrument(resolved.id);
  }
}
