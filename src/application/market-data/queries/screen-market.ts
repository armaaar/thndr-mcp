import { z } from 'zod';
import { type Quote, relativeVolume } from '../../../domain/market-data/instrument';
import {
  describeFilter,
  matchesScreener,
  SCREENER_PRESET_IDS,
  SCREENER_PRESETS,
  type Screener,
} from '../../../domain/market-data/screener';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

export const SCREEN_SORT_FIELDS = [
  'changePercent',
  'value',
  'volume',
  'relativeVolume',
  'marketCap',
  'last',
  'dividendYieldPercent',
  'peRatio',
] as const;
export type ScreenSortField = (typeof SCREEN_SORT_FIELDS)[number];

const input = {
  market: marketInput,
  index: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Only members of this index, e.g. "EGX30", "EGX70 EWI", "SHARIAH" (see get_index_constituents)',
    ),
  preset: z
    .enum(SCREENER_PRESET_IDS)
    .optional()
    .describe("Apply one of ThndrX's built-in screeners (see get_screeners), evaluated as ThndrX does"),
  screenerId: z
    .string()
    .min(1)
    .optional()
    .describe("Apply one of the user's saved Thndr screeners by id (see get_screeners)"),
  sector: z.string().optional().describe('Sector name or part of it, e.g. "Banks", "Real Estate"'),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  minChangePercent: z.number().optional(),
  maxChangePercent: z.number().optional(),
  minValue: z.number().optional().describe('Minimum traded value today (EGP)'),
  minRelativeVolume: z.number().optional().describe('Volume as % of the 30-day average'),
  maxPeRatio: z.number().optional(),
  minDividendYield: z.number().optional().describe('Percent'),
  includeSuspended: z.boolean().default(false),
  sortBy: z.enum(SCREEN_SORT_FIELDS).default('changePercent'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(100).default(20),
};

export type ScreenCriteria = InputOf<typeof input>;
export interface ScreenResult {
  market: Market;
  /** The index whose members were screened, when `index` was given. */
  index?: string;
  /** The preset and/or saved screener applied, with their filters in plain words. */
  screeners?: Array<{ id: string; name: string; filters: string[] }>;
  total: number;
  results: Array<Quote & { relativeVolume: number | null }>;
}

/**
 * Screens the market snapshot. ThndrX evaluates screeners client-side on marketwatch rows (docs/api/market-data.md
 * §5.1); we do the same, which also powers "top gainers/losers/most active". Index rows (board `INDX`) are never
 * results. Explicit criteria, `index`, `preset` and `screenerId` all apply together (AND); preset and saved-screener
 * filters use ThndrX's evaluation rules (`matchesScreener`), the explicit criteria ours.
 */
export class ScreenMarket extends Query<typeof input, ScreenResult> {
  readonly name = 'screen_market';
  readonly title = 'Screen the market';
  readonly description =
    'Filter and rank every instrument of a market using the live snapshot — e.g. top gainers ' +
    '(sortBy=changePercent), top losers (order=asc), most active (sortBy=value), unusual volume ' +
    '(minRelativeVolume=200), value stocks (maxPeRatio, minDividendYield), a sector, the members of an index ' +
    "(index=EGX30), one of ThndrX's built-in screeners (preset=momentum-movers, breakout-radar, value-yield, " +
    "steady-performers, reversal-watch) or one of the user's saved screeners (screenerId, see get_screeners). " +
    'All given filters apply together. Index rows are never returned.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(criteria: ScreenCriteria): Promise<ScreenResult> {
    const market = parseMarket(criteria.market);
    const [all, members, screeners] = await Promise.all([
      this.deps.quotes.get(market),
      criteria.index === undefined ? null : this.deps.indices.find(criteria.index, market),
      this.screeners(criteria, market),
    ]);
    const memberIds = members ? new Set(members.members.map((id) => id.value)) : null;
    const filters = screeners.flatMap((screener) => screener.filters);
    const sector = criteria.sector?.trim().toLowerCase();
    const within = (value: number | null, min?: number, max?: number) =>
      (min === undefined || (value !== null && value >= min)) &&
      (max === undefined || (value !== null && value <= max));
    const rows = all
      .map((q) => ({ ...q, relativeVolume: relativeVolume(q) }))
      .filter(
        (q) =>
          q.board !== 'INDX' &&
          (!memberIds || memberIds.has(q.instrumentId.value)) &&
          (criteria.includeSuspended || !q.suspended) &&
          (!sector || (q.sector ?? '').toLowerCase().includes(sector)) &&
          within(q.last, criteria.minPrice, criteria.maxPrice) &&
          within(q.changePercent, criteria.minChangePercent, criteria.maxChangePercent) &&
          within(q.value, criteria.minValue) &&
          within(q.relativeVolume, criteria.minRelativeVolume) &&
          within(q.peRatio, undefined, criteria.maxPeRatio) &&
          within(q.dividendYieldPercent, criteria.minDividendYield) &&
          matchesScreener(q, filters),
      );
    const sortBy = criteria.sortBy ?? 'changePercent';
    const direction = criteria.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[sortBy];
      const y = b[sortBy];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction;
    });
    return {
      market,
      ...(members ? { index: members.ticker.value } : {}),
      ...(screeners.length > 0
        ? {
            screeners: screeners.map((s) => ({
              id: s.id,
              name: s.name,
              filters: s.filters.map(describeFilter),
            })),
          }
        : {}),
      total: rows.length,
      results: rows.slice(0, Math.min(Math.max(criteria.limit ?? 20, 1), 100)),
    };
  }

  /** The preset and the saved screener asked for; a screener with filters we cannot evaluate is refused. */
  private async screeners(criteria: ScreenCriteria, market: Market): Promise<Screener[]> {
    const out: Screener[] = [];
    if (criteria.preset !== undefined) {
      const preset = SCREENER_PRESETS.find((p) => p.id === criteria.preset);
      if (!preset) throw new ValidationError(`Unknown screener preset "${criteria.preset}"`);
      out.push(preset);
    }
    if (criteria.screenerId !== undefined) {
      const saved = await this.deps.repository.getScreener(criteria.screenerId);
      if (saved.market !== null && saved.market !== market) {
        throw new ValidationError(
          `Screener "${saved.name}" was saved for the ${saved.market} market; run it with market "${saved.market}".`,
        );
      }
      if (saved.unsupported.length > 0) {
        throw new ValidationError(
          `Screener "${saved.name}" has filters thndr-mcp cannot evaluate: ${saved.unsupported.join('; ')}.`,
        );
      }
      out.push(saved);
    }
    return out;
  }
}
