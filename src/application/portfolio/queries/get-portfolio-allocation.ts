import type { Quote } from '../../../domain/market-data/instrument';
import type { AccountSummary } from '../../../domain/portfolio/account-summary';
import {
  type AllocationBucket,
  groupAllocation,
  NO_INDEX,
  sectorBucket,
} from '../../../domain/portfolio/allocation';
import {
  type AssetClassWeight,
  computeAllocation,
  type PositionWeight,
} from '../../../domain/portfolio/position';
import type { AssetClass, Market } from '../../../domain/shared-kernel/market';
import { MARKET_PROFILES, marketSupports, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { snapshotMarket } from '../../market-data/services/snapshot-market';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = { market: marketInput };

/** Instrument-details lookups for sectors missing from the market snapshot, heaviest holdings first. */
export const MAX_SECTOR_LOOKUPS = 30;
/** Lookups in flight at once (Thndr rate-limits bursts). */
const LOOKUP_CONCURRENCY = 5;

export interface AllocationHolding {
  readonly ticker: string;
  readonly instrumentId: string | null;
  readonly assetClass: AssetClass;
  /**
   * Sector bucket: the market snapshot's sector (Egypt), else the instrument's industry from its details, else
   * `Funds (no sector)` or `Unclassified`.
   */
  readonly sector: string;
  /** Symbols of the indices the holding belongs to. */
  readonly indices: readonly string[];
  readonly marketValue: number;
  readonly weightPercent: number;
}

export interface PortfolioAllocationResult {
  market: Market;
  currency: AccountSummary['currency'];
  portfolioValue: number;
  /** Denominator of every weight: the portfolio value (positions only, cash excluded) when positive. */
  basis: number;
  totalMarketValue: number;
  holdings: AllocationHolding[];
  byAssetClass: readonly AssetClassWeight[];
  bySector: AllocationBucket[];
  /** Overlapping buckets: a holding counts in every index it belongs to. */
  byIndex: AllocationBucket[];
  notes: string[];
}

export class GetPortfolioAllocation extends Query<typeof input, PortfolioAllocationResult> {
  readonly name = 'get_portfolio_allocation';
  readonly title = 'Portfolio allocation';
  readonly description =
    'All markets: holdings weighted by market value and grouped by asset class and by sector ("Unclassified" or ' +
    '"Funds (no sector)" when Thndr gives none). Egypt (and the simulator, through Egypt\'s data): sectors from the ' +
    'market snapshot and buckets by index membership (EGX30, EGX70 EWI, Shariah…; they overlap and do not sum to ' +
    `100%). US and UAE: sectors from instrument details (at most ${MAX_SECTOR_LOOKUPS} holdings, heaviest first) and ` +
    'no index buckets.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PortfolioAllocationResult> {
    const market = parseMarket(params.market);
    // US/UAE have no marketwatch (Thndr answers 400); the simulator trades Egypt's listings and reads Egypt's.
    const snapshot = snapshotMarket(market);
    const withIndices = snapshot !== null && marketSupports(snapshot, 'indices');
    const [{ summary, positions }, quotes, membership] = await Promise.all([
      this.deps.repository.getAccount(market),
      snapshot ? this.deps.quotes.get(snapshot) : Promise.resolve([] as Quote[]),
      withIndices ? this.deps.indices.membership(snapshot) : Promise.resolve(new Map<string, string[]>()),
    ]);
    const allocation = computeAllocation(positions, summary.portfolioValue);
    const byId = new Map<string, Quote>(quotes.map((q) => [q.instrumentId.value, q]));
    const byTicker = new Map<string, Quote>(quotes.map((q) => [q.ticker.value, q]));
    const quoteOf = (p: PositionWeight) =>
      (p.instrumentId ? byId.get(p.instrumentId.value) : undefined) ?? byTicker.get(p.ticker.value);
    const details = await this.sectorsFromDetails(
      allocation.positions.filter((p) => !quoteOf(p)),
      market,
    );

    const holdings: AllocationHolding[] = allocation.positions.map((p) => {
      const quote = quoteOf(p);
      // The matched quote's id is the snapshot's (and the index members') id; the position's id is only a fallback.
      const id = quote?.instrumentId.value ?? p.instrumentId?.value ?? null;
      const sector = quote ? quote.sector : id ? details.sectors.get(id) : undefined;
      return Object.freeze({
        ticker: p.ticker.value,
        instrumentId: id,
        assetClass: p.assetClass,
        sector: sectorBucket(sector, p.assetClass),
        indices: Object.freeze([...((id ? membership.get(id) : undefined) ?? [])].sort()),
        marketValue: p.marketValue,
        weightPercent: p.weightPercent,
      });
    });

    const basis = allocation.basis;
    const notes = [
      'Weights are shares of the portfolio value (market value of positions; cash is excluded).',
    ];
    if (withIndices) {
      notes.push(
        'Index buckets overlap: a holding counts in every index it belongs to, so they do not sum to 100%.',
        'Sectors come from Thndr\'s market snapshot; funds have no sector there and are grouped as "Funds (no sector)".',
      );
    } else {
      notes.push(
        `No index buckets: Thndr publishes index membership only for Egypt, not for the ${MARKET_PROFILES[market].name} market.`,
      );
    }
    if (details.looked > 0 || details.skipped > 0)
      notes.push(
        `Sectors of ${details.looked} holding(s) absent from a market snapshot come from their instrument details ` +
          `(Thndr's industry), at most ${MAX_SECTOR_LOOKUPS}, heaviest first` +
          (details.skipped > 0
            ? `; ${details.skipped} lighter holding(s) were not looked up (Unclassified)`
            : '') +
          (details.failed > 0 ? `; ${details.failed} lookup(s) failed (Unclassified)` : '') +
          '.',
      );
    return {
      market,
      currency: summary.currency,
      portfolioValue: summary.portfolioValue,
      basis,
      totalMarketValue: allocation.totalMarketValue,
      holdings,
      byAssetClass: allocation.byAssetClass,
      bySector: groupAllocation(holdings, basis, (h) => [h.sector]),
      byIndex: withIndices
        ? groupAllocation(holdings, basis, (h) => (h.indices.length > 0 ? h.indices : [NO_INDEX]))
        : [],
      notes,
    };
  }

  /**
   * Sectors (Thndr's industry) of holdings the snapshot does not cover, from instrument details: holdings with an
   * instrument id, heaviest first, at most {@link MAX_SECTOR_LOOKUPS}; a failed lookup leaves the holding unclassified.
   */
  private async sectorsFromDetails(
    uncovered: readonly PositionWeight[],
    market: Market,
  ): Promise<{ sectors: Map<string, string | null>; looked: number; skipped: number; failed: number }> {
    const withId = [...uncovered]
      .filter((p) => p.instrumentId !== null)
      .sort((a, b) => b.marketValue - a.marketValue);
    const chosen = withId.slice(0, MAX_SECTOR_LOOKUPS);
    const sectors = new Map<string, string | null>();
    let failed = 0;
    for (let i = 0; i < chosen.length; i += LOOKUP_CONCURRENCY) {
      await Promise.all(
        chosen.slice(i, i + LOOKUP_CONCURRENCY).map(async (p) => {
          const id = (p.instrumentId as NonNullable<PositionWeight['instrumentId']>).value;
          try {
            sectors.set(id, (await this.deps.resolver.resolve(id, market)).sector);
          } catch {
            failed++;
          }
        }),
      );
    }
    return { sectors, looked: chosen.length, skipped: withId.length - chosen.length, failed };
  }
}
