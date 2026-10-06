import { z } from 'zod';
import { parseMarket } from '../../../domain/market-data/market';
import type { Position } from '../../../domain/portfolio/position';
import type { SellableQuantity } from '../../../domain/portfolio/sellable-quantity';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {
  symbol: symbolInput,
  market: marketInput,
  includeSellable: z.boolean().default(false),
};

export interface PositionResult {
  ticker: string;
  held: boolean;
  position: Position | null;
  sellable: SellableQuantity | null;
}

export class GetPosition extends Query<typeof input, PositionResult> {
  readonly name = 'get_position';
  readonly title = 'Position in one instrument';
  readonly description =
    'The holding in one instrument (or held=false). With includeSellable=true also returns how many shares ' +
    'can be sold now per settlement cycle (T0, T1, T+2).';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PositionResult> {
    const market = parseMarket(params.market);
    const instrument = await this.deps.resolver.resolve(params.symbol, market);
    const position = await this.deps.repository.getPosition(instrument.id, market);
    const held = position !== null && position.quantity > 0;
    const sellable =
      held && params.includeSellable !== false
        ? await this.deps.repository.getSellableQuantity(instrument.id, market)
        : null;
    return { ticker: instrument.ticker.value, held, position, sellable };
  }
}
