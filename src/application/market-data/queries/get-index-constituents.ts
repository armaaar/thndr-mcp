import { z } from 'zod';
import type { Quote } from '../../../domain/market-data/instrument';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

export const CONSTITUENT_SORT_FIELDS = [
  'marketCap',
  'changePercent',
  'value',
  'volume',
  'last',
  'ticker',
] as const;

const input = {
  index: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Index symbol or name, e.g. "EGX30", "EGX70" (→ EGX70-EWI), "SHARIAH" or "EGX33". Omit to list the indices',
    ),
  market: marketInput,
  sortBy: z.enum(CONSTITUENT_SORT_FIELDS).default('marketCap'),
  order: z.enum(['asc', 'desc']).optional().describe('Default: asc for ticker, desc otherwise'),
  limit: z.number().int().min(1).max(300).default(100),
};

export interface IndexSummary {
  ticker: string;
  name: string | null;
  /** The index level: the last value of its marketwatch row (points). */
  level: number | null;
  changePercent: number | null;
  memberCount: number;
}

export interface Constituent {
  ticker: string;
  name: string | null;
  sector: string | null;
  last: number | null;
  changePercent: number | null;
  value: number | null;
  volume: number | null;
  marketCap: number | null;
}

export type IndexConstituents =
  | { market: Market; indices: IndexSummary[] }
  | {
      market: Market;
      index: IndexSummary;
      /** Members found in the market snapshot (before the limit). */
      total: number;
      members: Constituent[];
      /** Members Thndr lists for the index that are absent from the market snapshot. */
      missingFromSnapshot: number;
    };

function compare(a: number | string | null, b: number | string | null, direction: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (typeof a === 'string' ? a.localeCompare(String(b)) : a - Number(b)) * direction;
}

/**
 * The indices of a market, or one index with its member instruments joined with the market snapshot. Members come
 * from `IndexMembership` (the index's asset details); Thndr publishes no weights, so none are returned.
 */
export class GetIndexConstituents extends Query<typeof input, IndexConstituents> {
  readonly name = 'get_index_constituents';
  readonly title = 'Index constituents';
  readonly description =
    'Egypt only. Without `index`: the indices of the market (EGX30, EGX30 Capped, EGX70 EWI, EGX100 EWI, EGX35-LV, Shariah, ' +
    'Tamayuz…) with level, change % and member count. With `index`: its member instruments with sector, last ' +
    'price, change %, traded value/volume and market cap, sorted by `sortBy`. Thndr gives no index weights.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<IndexConstituents> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'indices');
    const [quotes, indices] = await Promise.all([
      this.deps.quotes.get(market),
      this.deps.indices.indices(market),
    ]);
    const byId = new Map(quotes.map((q) => [q.instrumentId.value, q]));
    const summary = (index: (typeof indices)[number]): IndexSummary => {
      const row = byId.get(index.id.value);
      return {
        ticker: index.ticker.value,
        name: index.name,
        level: row?.last ?? null,
        changePercent: row?.changePercent ?? null,
        memberCount: index.members.length,
      };
    };
    if (params.index === undefined) return { market, indices: indices.map(summary) };

    const index = await this.deps.indices.find(params.index, market);
    const found: Quote[] = [];
    let missing = 0;
    for (const member of index.members) {
      const quote = byId.get(member.value);
      if (quote) found.push(quote);
      else missing++;
    }
    const sortBy = params.sortBy ?? 'marketCap';
    const direction = (params.order ?? (sortBy === 'ticker' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
    const key = (q: Quote) => (sortBy === 'ticker' ? q.ticker.value : q[sortBy]);
    found.sort((a, b) => compare(key(a), key(b), direction));
    return {
      market,
      index: summary(index),
      total: found.length,
      members: found.slice(0, Math.min(Math.max(params.limit ?? 100, 1), 300)).map((q) => ({
        ticker: q.ticker.value,
        name: q.name,
        sector: q.sector,
        last: q.last,
        changePercent: q.changePercent,
        value: q.value,
        volume: q.volume,
        marketCap: q.marketCap,
      })),
      missingFromSnapshot: missing,
    };
  }
}
