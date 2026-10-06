import type { MarketDataRepository } from '../../../domain/market-data/repository';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import type { Market } from '../../../domain/shared-kernel/market';
import type { Ticker } from '../../../domain/shared-kernel/ticker';
import { NotFoundError } from '../../errors';
import type { Clock } from '../../ports/clock';
import type { MarketQuotesCache } from './market-quotes-cache';

/** An index of a market with its member instruments. */
export interface MarketIndex {
  readonly id: AssetId;
  /** Sanitised symbol, e.g. `EGX30`, `EGX70-EWI`, `SHARIAH`. */
  readonly ticker: Ticker;
  readonly name: string | null;
  readonly members: readonly AssetId[];
}

/** Upper-case letters and digits only, so `EGX70 EWI`, `EGX70-EWI` and `egx70ewi` compare equal. */
function normalize(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Which instruments belong to which index. ThndrX lists the indices as marketwatch rows on the `INDX` board and reads
 * each index's members from `constituents` on its asset details (docs/api/market-data.md §1.2). Membership only
 * changes at index rebalances, so it is cached per market for `ttlMs` (6 hours by default).
 */
export class IndexMembership {
  private readonly entries = new Map<Market, { at: number; indices: Promise<MarketIndex[]> }>();

  constructor(
    private readonly repository: MarketDataRepository,
    private readonly quotes: MarketQuotesCache,
    private readonly clock: Clock,
    private readonly ttlMs = 6 * 3_600_000,
  ) {}

  /** Every index of the market with its members. */
  indices(market: Market): Promise<MarketIndex[]> {
    const now = this.clock.now().getTime();
    const entry = this.entries.get(market);
    if (entry && now - entry.at < this.ttlMs) return entry.indices;
    const indices = this.load(market);
    const fresh = { at: now, indices };
    this.entries.set(market, fresh);
    indices.catch(() => {
      if (this.entries.get(market) === fresh) this.entries.delete(market);
    });
    return indices;
  }

  /**
   * The index named `symbol`: an exact match ignoring case and separators (`EGX70 EWI` = `egx70-ewi`), else the only
   * index whose symbol starts with it (`EGX70` → `EGX70-EWI`, `sharia` → `SHARIAH`).
   */
  async find(symbol: string, market: Market): Promise<MarketIndex> {
    const indices = await this.indices(market);
    const wanted = normalize(symbol);
    const exact = indices.find((index) => normalize(index.ticker.value) === wanted);
    if (exact) return exact;
    const prefixed = wanted
      ? indices.filter((index) => normalize(index.ticker.value).startsWith(wanted))
      : [];
    if (prefixed.length === 1 && prefixed[0]) return prefixed[0];
    const available = (prefixed.length > 1 ? prefixed : indices)
      .map((index) => index.ticker.value)
      .join(', ');
    throw new NotFoundError(
      `No single ${market} index matches "${symbol}".${available ? ` Indices: ${available}.` : ''}`,
    );
  }

  /** Instrument id → symbols of the indices it belongs to. */
  async membership(market: Market): Promise<Map<string, string[]>> {
    const byInstrument = new Map<string, string[]>();
    for (const index of await this.indices(market)) {
      for (const member of index.members) {
        byInstrument.set(member.value, [...(byInstrument.get(member.value) ?? []), index.ticker.value]);
      }
    }
    return byInstrument;
  }

  private async load(market: Market): Promise<MarketIndex[]> {
    const rows = (await this.quotes.get(market)).filter((quote) => quote.board === 'INDX');
    return Promise.all(
      rows.map(async (row) =>
        Object.freeze({
          id: row.instrumentId,
          ticker: row.ticker,
          name: row.name,
          members: Object.freeze(await this.repository.getIndexConstituents(row.instrumentId)),
        }),
      ),
    );
  }
}
