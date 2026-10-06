import type { Quote } from '../../../domain/market-data/instrument';
import type { AccountSummary } from '../../../domain/portfolio/account-summary';
import {
  type AllocationBucket,
  groupAllocation,
  NO_INDEX,
  sectorBucket,
} from '../../../domain/portfolio/allocation';
import { type AssetClassWeight, computeAllocation } from '../../../domain/portfolio/position';
import type { AssetClass, Market } from '../../../domain/shared-kernel/market';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = { market: marketInput };

export interface AllocationHolding {
  readonly ticker: string;
  readonly instrumentId: string | null;
  readonly assetClass: AssetClass;
  /** Sector bucket: the market snapshot's sector, `Funds (no sector)` or `Unclassified`. */
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
    'Holdings weighted by market value and grouped by asset class, by sector (from the market snapshot; ' +
    '"Unclassified" or "Funds (no sector)" when Thndr gives none) and by index membership (EGX30, EGX70 EWI, ' +
    'Shariah…). Index buckets overlap and do not sum to 100%.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PortfolioAllocationResult> {
    const market = parseMarket(params.market);
    const [{ summary, positions }, quotes, membership] = await Promise.all([
      this.deps.repository.getAccount(market),
      this.deps.quotes.get(market),
      this.deps.indices.membership(market),
    ]);
    const allocation = computeAllocation(positions, summary.portfolioValue);
    const byId = new Map<string, Quote>(quotes.map((q) => [q.instrumentId.value, q]));
    const byTicker = new Map<string, Quote>(quotes.map((q) => [q.ticker.value, q]));

    const holdings: AllocationHolding[] = allocation.positions.map((p) => {
      const quote =
        (p.instrumentId ? byId.get(p.instrumentId.value) : undefined) ?? byTicker.get(p.ticker.value);
      // The matched quote's id is the snapshot's (and the index members') id; the position's id is only a fallback.
      const id = quote?.instrumentId.value ?? p.instrumentId?.value ?? null;
      return Object.freeze({
        ticker: p.ticker.value,
        instrumentId: id,
        assetClass: p.assetClass,
        sector: sectorBucket(quote?.sector, p.assetClass),
        indices: Object.freeze([...((id ? membership.get(id) : undefined) ?? [])].sort()),
        marketValue: p.marketValue,
        weightPercent: p.weightPercent,
      });
    });

    const basis = allocation.basis;
    return {
      market,
      currency: summary.currency,
      portfolioValue: summary.portfolioValue,
      basis,
      totalMarketValue: allocation.totalMarketValue,
      holdings,
      byAssetClass: allocation.byAssetClass,
      bySector: groupAllocation(holdings, basis, (h) => [h.sector]),
      byIndex: groupAllocation(holdings, basis, (h) => (h.indices.length > 0 ? h.indices : [NO_INDEX])),
      notes: [
        'Weights are shares of the portfolio value (market value of positions; cash is excluded).',
        'Index buckets overlap: a holding counts in every index it belongs to, so they do not sum to 100%.',
        'Sectors come from Thndr\'s market snapshot; funds have no sector there and are grouped as "Funds (no sector)".',
      ],
    };
  }
}
