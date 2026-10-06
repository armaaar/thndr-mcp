import type { Quote } from '../../../domain/market-data/instrument';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import type { Market } from '../../../domain/shared-kernel/market';
import type { InstrumentResolver } from '../../market-data/services/instrument-resolver';
import type { MarketQuotesCache } from '../../market-data/services/market-quotes-cache';
import { snapshotMarket } from '../../market-data/services/snapshot-market';
import type { EngagementDependencies } from '../dependencies';
import { emptyLabel, type InstrumentLabel, InstrumentLabels } from './instrument-labels';

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

  static for(deps: Pick<EngagementDependencies, 'resolver' | 'quotes'>): InstrumentLabeler {
    return new InstrumentLabeler(deps.resolver, deps.quotes);
  }

  async label(ids: readonly AssetId[], market: Market): Promise<InstrumentLabels> {
    const out = new Map<string, InstrumentLabel>();
    if (ids.length === 0) return new InstrumentLabels(out);
    const snapshot = await this.snapshot(market);
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
    const snapshot = await this.snapshot(market);
    return snapshot.find((q) => q.instrumentId.equals(id))?.last ?? null;
  }

  /** The whole-market quotes serving `market` — none for the US and the UAE, which have no snapshot (ADR 0021). */
  private async snapshot(market: Market): Promise<Quote[]> {
    const source = snapshotMarket(market);
    return source ? this.quotes.get(source).catch(() => [] as Quote[]) : [];
  }
}
