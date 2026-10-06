import type { Quote } from '../../../domain/market-data/instrument';
import type { MarketSession } from '../../../domain/market-data/order-book';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { market: marketInput };

/** Bounds the instrument lookups for default indices missing from the levels feed. */
const MAX_INDICES = 20;

export interface IndexLevelView {
  ticker: string;
  name: string | null;
  level: number | null;
  changePercent: number | null;
  previousClose: number | null;
}

export interface MarketStatus extends MarketSession {
  indices: IndexLevelView[];
}

export class GetMarketStatus extends Query<typeof input, MarketStatus> {
  readonly name = 'get_market_status';
  readonly title = 'Market status';
  readonly description =
    "Whether the market is open now, today's session open/close times and the market's main indices and " +
    'benchmarks as Thndr shows them (Egypt: EGX30, EGX70…; US: SPY, QQQ, DIA…; UAE: FADGI…). EGX regular ' +
    'session: Sunday–Thursday 10:00–14:30 Africa/Cairo.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<MarketStatus> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'marketStatus');
    const [session, levels, defaults] = await Promise.all([
      this.deps.repository.getMarketSession(market),
      // Indices only enrich the answer: tolerate failures.
      this.deps.repository.getMarketIndicators(market).catch(() => [] as Quote[]),
      this.deps.discovery.getDefaultIndicatorIds(market).catch(() => null),
    ]);
    return { ...session, indices: await this.indices(market, levels, defaults) };
  }

  /**
   * Thndr's levels feed ignores the market (it mixes EGX indices, US ETFs, ADX indices and FX rates), so the
   * market's default indicator list (the app's per-market indices) picks and orders the entries. Each pick is checked
   * against its instrument's market (asset details, cached by the resolver) in case the gateway's list mixes markets
   * too; a pick whose details fail is kept only when the feed has it. Picks missing from the feed are named from their
   * details, without a level. Without a list only Egypt keeps the whole feed, as before.
   */
  private async indices(
    market: Market,
    levels: readonly Quote[],
    defaults: readonly AssetId[] | null,
  ): Promise<IndexLevelView[]> {
    if (defaults === null || defaults.length === 0) return market === 'egypt' ? levels.map(toLevel) : [];
    const byId = new Map(levels.map((q) => [q.instrumentId.value, q]));
    const picked = defaults.slice(0, MAX_INDICES);
    const views = await Promise.all(
      picked.map(async (id): Promise<IndexLevelView | null> => {
        const quote = byId.get(id.value);
        const instrument = await this.deps.resolver.resolve(id.value, market).catch(() => null);
        if (instrument && instrument.market !== market) return null;
        if (quote) return toLevel(quote);
        return instrument
          ? {
              ticker: instrument.ticker.value,
              name: instrument.name,
              level: null,
              changePercent: null,
              previousClose: null,
            }
          : null;
      }),
    );
    return views.filter((v): v is IndexLevelView => v !== null);
  }
}

function toLevel(quote: Quote): IndexLevelView {
  return {
    ticker: quote.ticker.value,
    name: quote.name,
    level: quote.last,
    changePercent: quote.changePercent,
    previousClose: quote.previousClose,
  };
}
