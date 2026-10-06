import { AssetId } from '../../../domain/market-data/asset-id';
import type { Instrument } from '../../../domain/market-data/instrument';
import type { Market } from '../../../domain/market-data/market';
import type { MarketDataRepository } from '../../../domain/market-data/repository';
import { Ticker } from '../../../domain/shared-kernel/ticker';
import { NotFoundError } from '../../errors';

/**
 * Resolves what a user types (`COMI`, `comi`, or a Thndr asset UUID) to an instrument.
 * Results are cached for the process lifetime: listings rarely change.
 */
export class InstrumentResolver {
  private readonly byTicker = new Map<string, Instrument>();
  private readonly byId = new Map<string, Instrument>();

  constructor(private readonly repository: MarketDataRepository) {}

  async resolve(symbolOrId: string, market: Market): Promise<Instrument> {
    if (AssetId.isAssetId(symbolOrId)) {
      const id = AssetId.of(symbolOrId);
      const cached = this.byId.get(id.value);
      if (cached) return cached;
      return this.remember(await this.repository.getInstrument(id));
    }
    const ticker = Ticker.of(symbolOrId);
    const key = `${market}:${ticker.value}`;
    const cached = this.byTicker.get(key);
    if (cached) return cached;
    const results = await this.repository.searchInstruments(ticker.value, market);
    const exact = results.find((instrument) => instrument.ticker.equals(ticker));
    if (!exact) {
      const suggestions = results
        .slice(0, 5)
        .map((i) => i.ticker.value)
        .join(', ');
      throw new NotFoundError(
        `No ${market} instrument with ticker ${ticker.value}.${suggestions ? ` Did you mean: ${suggestions}?` : ' Try search_instruments.'}`,
      );
    }
    return this.remember(exact);
  }

  async resolveMany(symbolsOrIds: readonly string[], market: Market): Promise<Instrument[]> {
    return Promise.all(symbolsOrIds.map((s) => this.resolve(s, market)));
  }

  /** Lets other use cases seed the cache with instruments they already loaded. */
  remember(instrument: Instrument): Instrument {
    this.byId.set(instrument.id.value, instrument);
    this.byTicker.set(`${instrument.market}:${instrument.ticker.value}`, instrument);
    return instrument;
  }
}
