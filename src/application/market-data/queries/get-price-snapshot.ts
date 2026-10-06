import { z } from 'zod';
import type { Quote } from '../../../domain/market-data/instrument';
import { parseMarket } from '../../../domain/market-data/market';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { symbols: z.array(symbolInput).min(1).max(50), market: marketInput };

export class GetPriceSnapshot extends Query<typeof input, { quotes: Quote[]; missing: string[] }> {
  readonly name = 'get_price_snapshot';
  readonly title = 'Price snapshot';
  readonly description =
    'Current quote for up to 50 instruments: last price, change, open/high/low, bid/ask, volume, value, daily ' +
    'price limits, 52-week range, P/E, EPS, dividend yield and market cap.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<{ quotes: Quote[]; missing: string[] }> {
    if (params.symbols.length === 0) throw new ValidationError('Provide at least one symbol');
    if (params.symbols.length > 50) throw new ValidationError('At most 50 symbols per request');
    const market = parseMarket(params.market);
    const [instruments, all] = await Promise.all([
      this.deps.resolver.resolveMany(params.symbols, market),
      this.deps.quotes.get(market),
    ]);
    const byId = new Map(all.map((q) => [q.instrumentId.value, q]));
    const quotes: Quote[] = [];
    const missing: string[] = [];
    for (const instrument of instruments) {
      const quote = byId.get(instrument.id.value);
      if (quote) quotes.push(quote);
      else missing.push(instrument.ticker.value);
    }
    return { quotes, missing };
  }
}
