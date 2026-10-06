import { z } from 'zod';
import { type Quote, relativeVolume } from '../../../domain/market-data/instrument';
import { type Market, parseMarket } from '../../../domain/market-data/market';
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
  total: number;
  results: Array<Quote & { relativeVolume: number | null }>;
}

/**
 * Screens the market snapshot. ThndrX evaluates screeners client-side on marketwatch rows (docs/api/market-data.md
 * §5.1); we do the same, which also powers "top gainers/losers/most active".
 */
export class ScreenMarket extends Query<typeof input, ScreenResult> {
  readonly name = 'screen_market';
  readonly title = 'Screen the market';
  readonly description =
    'Filter and rank every instrument of a market using the live snapshot — e.g. top gainers ' +
    '(sortBy=changePercent), top losers (order=asc), most active (sortBy=value), unusual volume ' +
    '(minRelativeVolume=200), value stocks (maxPeRatio, minDividendYield) or a sector.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(criteria: ScreenCriteria): Promise<ScreenResult> {
    const market = parseMarket(criteria.market);
    const all = await this.deps.quotes.get(market);
    const sector = criteria.sector?.trim().toLowerCase();
    const within = (value: number | null, min?: number, max?: number) =>
      (min === undefined || (value !== null && value >= min)) &&
      (max === undefined || (value !== null && value <= max));
    const rows = all
      .map((q) => ({ ...q, relativeVolume: relativeVolume(q) }))
      .filter(
        (q) =>
          (criteria.includeSuspended || !q.suspended) &&
          (!sector || (q.sector ?? '').toLowerCase().includes(sector)) &&
          within(q.last, criteria.minPrice, criteria.maxPrice) &&
          within(q.changePercent, criteria.minChangePercent, criteria.maxChangePercent) &&
          within(q.value, criteria.minValue) &&
          within(q.relativeVolume, criteria.minRelativeVolume) &&
          within(q.peRatio, undefined, criteria.maxPeRatio) &&
          within(q.dividendYieldPercent, criteria.minDividendYield),
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
      total: rows.length,
      results: rows.slice(0, Math.min(Math.max(criteria.limit ?? 20, 1), 100)),
    };
  }
}
