import { z } from 'zod';
import type { Quote } from '../../../domain/market-data/instrument';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { LATEST_PRICE_NOTE, quoteInstruments } from '../services/instrument-quotes';

const input = {
  symbols: z
    .array(symbolInput)
    .min(1)
    .max(50)
    .describe('Tickers of `market`, or Thndr asset ids of any market (they may be mixed)'),
  market: marketInput,
};

export interface PriceSnapshot {
  quotes: Quote[];
  /** Instruments Thndr has no quote for. */
  missing: string[];
  /** Present when some quotes come from the thinner bulk latest price (outside Egypt). */
  notes?: string[];
}

export class GetPriceSnapshot extends Query<typeof input, PriceSnapshot> {
  readonly name = 'get_price_snapshot';
  readonly title = 'Price snapshot';
  readonly description =
    'All markets: current quote for up to 50 instruments. Egypt: last price, change, open/high/low, bid/ask, volume, ' +
    'value, daily price limits, 52-week range, P/E, EPS, dividend yield and market cap. US, UAE and other ' +
    'instruments: last, open, previous close, change, change %, bid/ask when known and the price time; other fields ' +
    'null. Asset ids of different markets may be mixed.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PriceSnapshot> {
    if (params.symbols.length === 0) throw new ValidationError('Provide at least one symbol');
    if (params.symbols.length > 50) throw new ValidationError('At most 50 symbols per request');
    const market = parseMarket(params.market);
    const instruments = await this.deps.resolver.resolveMany(params.symbols, market);
    // Each instrument is quoted from its own market's source (marketwatch for Egypt, the bulk price elsewhere).
    const byId = await quoteInstruments(this.deps, instruments);
    const quotes: Quote[] = [];
    const missing: string[] = [];
    let thin = false;
    for (const instrument of instruments) {
      const found = byId.get(instrument.id.value);
      if (!found) {
        missing.push(instrument.ticker.value);
        continue;
      }
      quotes.push(found.quote);
      thin ||= found.source === 'latest-price';
    }
    return { quotes, missing, ...(thin ? { notes: [LATEST_PRICE_NOTE] } : {}) };
  }
}
