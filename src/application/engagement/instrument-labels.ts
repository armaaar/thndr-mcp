import { AssetId } from '../../domain/market-data/asset-id.js';
import type { Quote } from '../../domain/market-data/instrument.js';
import type { Market } from '../../domain/market-data/market.js';
import type { InstrumentResolver } from '../market-data/instrument-resolver.js';
import type { MarketQuotesCache } from '../market-data/quote-cache.js';

/** What we know about an instrument id for presentation: its ticker and, when available, its live quote. */
export interface InstrumentLabel {
  readonly instrumentId: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly last: number | null;
  readonly changePercent: number | null;
}

/**
 * Turns Thndr asset ids into tickers (and quote snippets) for watchlists and alerts. Uses the whole-market quote
 * snapshot first (one cached call), then the instrument resolver for ids missing from it (indices, funds…).
 * Never fails: unknown ids and upstream errors yield a label with null fields.
 */
export class InstrumentLabeler {
  constructor(
    private readonly resolver: InstrumentResolver,
    private readonly quotes: MarketQuotesCache,
  ) {}

  async label(ids: readonly AssetId[], market: Market): Promise<InstrumentLabels> {
    const out = new Map<string, InstrumentLabel>();
    if (ids.length === 0) return new InstrumentLabels(out);
    const snapshot = await this.quotes.get(market).catch(() => [] as Quote[]);
    const byId = new Map(snapshot.map((q) => [q.instrumentId.value, q]));
    const missing: AssetId[] = [];
    for (const id of ids) {
      const quote = byId.get(id.value);
      if (quote) {
        out.set(id.value, {
          instrumentId: id.value,
          ticker: quote.ticker.value,
          name: quote.name,
          last: quote.last,
          changePercent: quote.changePercent,
        });
      } else if (!out.has(id.value)) {
        out.set(id.value, emptyLabel(id.value));
        missing.push(id);
      }
    }
    await Promise.all(
      missing.map(async (id) => {
        const instrument = await this.resolver.resolve(id.value, market).catch(() => null);
        if (instrument) {
          out.set(id.value, {
            ...emptyLabel(id.value),
            ticker: instrument.ticker.value,
            name: instrument.name,
          });
        }
      }),
    );
    return new InstrumentLabels(out);
  }

  /** Current traded price of one instrument from the snapshot, or null when unknown. */
  async currentPrice(id: AssetId, market: Market): Promise<number | null> {
    const snapshot = await this.quotes.get(market).catch(() => [] as Quote[]);
    return snapshot.find((q) => q.instrumentId.equals(id))?.last ?? null;
  }
}

/** Labels keyed by asset id; ids that were never labelled get an all-null label. */
export class InstrumentLabels {
  constructor(private readonly byId: ReadonlyMap<string, InstrumentLabel>) {}

  get(id: AssetId): InstrumentLabel {
    return this.byId.get(id.value) ?? emptyLabel(id.value);
  }
}

export function emptyLabel(instrumentId: string): InstrumentLabel {
  return { instrumentId, ticker: null, name: null, last: null, changePercent: null };
}

/** Parses a raw id string the way labels are keyed; returns null for non-UUIDs. */
export function assetIdOrNull(raw: string): AssetId | null {
  return AssetId.isAssetId(raw) ? AssetId.of(raw) : null;
}
