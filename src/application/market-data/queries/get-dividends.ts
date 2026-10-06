import { z } from 'zod';
import type { DividendStatus, DividendType } from '../../../domain/market-data/discovery';
import { parseMarket } from '../../../domain/shared-kernel/market';
import type { Currency } from '../../../domain/shared-kernel/money';
import { marketInput, pageInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const input = {
  symbol: symbolInput,
  market: marketInput,
  page: pageInput.describe('Page number (1-based, newest first)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Dividends per page (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
};

export interface DividendView {
  id: string;
  type: DividendType;
  /** UPCOMING (announced), ONGOING (being paid) or PAST. */
  status: DividendStatus;
  /** Shareholders on record that day (YYYY-MM-DD) are entitled. */
  recordDate: string | null;
  /** Cash dividends: amount per share, in `currency`. */
  cashPerShare?: number | null;
  /** Stock dividends: bonus shares per share held (0.1 = one new share for every ten). */
  bonusSharesPerShare?: number | null;
  /** Dividends of an unknown type: Thndr's raw ratio. */
  ratio?: number | null;
  currency: Currency | null;
  frequency: string | null;
  couponNumber: string | null;
  /** Payment dates, with the part of the ratio paid on each. */
  distributions: Array<{ date: string | null; ratio: number | null }>;
}

export interface DividendsView {
  ticker: string;
  name: string;
  page: number;
  pageSize: number;
  /** Dividends across all pages, as Thndr counts them. */
  total: number | null;
  hasMore: boolean;
  dividends: DividendView[];
}

export class GetDividends extends Query<typeof input, DividendsView> {
  readonly name = 'get_dividends';
  readonly title = 'Dividends';
  readonly description =
    'An instrument’s dividends as Thndr records them, newest first: cash (amount per share) or stock (bonus shares ' +
    'per share), record date, payment dates, currency and status (upcoming, ongoing, past). Any market; an empty ' +
    'list means Thndr records none for it.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<DividendsView> {
    const instrument = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    const page = params.page ?? 1;
    const pageSize = params.limit ?? DEFAULT_LIMIT;
    const result = await this.deps.discovery.getDividends(instrument.id, { page, pageSize });
    return {
      ticker: instrument.ticker.value,
      name: instrument.name,
      page,
      pageSize,
      total: result.total,
      hasMore: result.total !== null ? page * pageSize < result.total : result.dividends.length >= pageSize,
      dividends: result.dividends.slice(0, pageSize).map((dividend) => ({
        id: dividend.id,
        type: dividend.type,
        status: dividend.status,
        recordDate: dividend.recordDate,
        ...(dividend.type === 'CASH'
          ? { cashPerShare: dividend.ratio }
          : dividend.type === 'STOCK'
            ? { bonusSharesPerShare: dividend.ratio }
            : { ratio: dividend.ratio }),
        currency: dividend.currency,
        frequency: dividend.frequency,
        couponNumber: dividend.couponNumber,
        distributions: dividend.distributions.map((d) => ({ date: d.date, ratio: d.ratio })),
      })),
    };
  }
}
