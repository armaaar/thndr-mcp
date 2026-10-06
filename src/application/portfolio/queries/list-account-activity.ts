import { z } from 'zod';
import {
  ACTIVITY_CATEGORIES,
  type AccountActivity,
  type ActivityCategory,
  type ActivityPage,
} from '../../../domain/portfolio/activity';
import type { DateRange } from '../../../domain/portfolio/journal';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, pageInput } from '../../inputs';
import { clamp } from '../../paging';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';
import { rangeInput, resolveRange } from '../range-input';

const input = {
  market: marketInput,
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  ...rangeInput,
  page: pageInput,
  pageSize: z.number().int().min(1).max(100).default(20),
};

export type AccountActivityResult = ActivityPage & {
  market: Market;
  /** Present when a date range was given: the bounds applied. */
  range?: { from: Date | null; to: Date | null };
  /** Range mode: the page cap was hit before reaching the start of the range, so older entries may be missing. */
  truncated?: boolean;
  /** Range mode: how many Thndr pages were read. */
  pagesFetched?: number;
};

export class ListAccountActivity extends Query<typeof input, AccountActivityResult> {
  /** Range mode reads Thndr pages of this size… */
  static readonly RANGE_PAGE_SIZE = 100;
  /** …and at most this many of them. */
  static readonly RANGE_MAX_PAGES = 20;

  readonly name = 'get_account_activity';
  readonly title = 'Account activity';
  readonly description =
    'Cash ledger: deposits, withdrawals, order settlements, dividends, fees and transfers. Without a date range ' +
    'it returns one page; with from/to or a period preset it returns every entry in the range (newest first, up ' +
    `to ${ListAccountActivity.RANGE_MAX_PAGES * ListAccountActivity.RANGE_PAGE_SIZE} scanned; truncated=true ` +
    'when the cap was hit).';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<AccountActivityResult> {
    const market = parseMarket(params.market);
    const category = parseActivityCategory(params.category);
    const keep = (a: AccountActivity) => category === null || a.category === category;
    const range = resolveRange(params, this.deps.clock, 'Activity');
    if (range.from || range.to) {
      if (params.page !== undefined && params.page !== 1) {
        throw new ValidationError(
          '"page" does not apply with a date range: every entry in the range is returned',
        );
      }
      return this.inRange(market, range, keep);
    }
    const page = clamp(params.page, 1, 1, 10_000);
    const result = await this.deps.repository.listActivities(
      market,
      page,
      clamp(params.pageSize, 20, 1, 100),
    );
    // Thndr has no server-side filter we can rely on: filter the fetched page.
    return { market, ...result, activities: result.activities.filter(keep) };
  }

  /**
   * Pages through the statement (newest first upstream) until a page reaches entries older than `from`, the last
   * page, or the page cap. Entries without a timestamp cannot be placed in the range and are left out.
   */
  private async inRange(
    market: Market,
    range: DateRange,
    keep: (a: AccountActivity) => boolean,
  ): Promise<AccountActivityResult> {
    const from = range.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = range.to?.getTime() ?? Number.POSITIVE_INFINITY;
    const collected: AccountActivity[] = [];
    let pagesFetched = 0;
    let hasMore = true;
    let reachedStart = false;
    while (hasMore && !reachedStart && pagesFetched < ListAccountActivity.RANGE_MAX_PAGES) {
      pagesFetched += 1;
      const page = await this.deps.repository.listActivities(
        market,
        pagesFetched,
        ListAccountActivity.RANGE_PAGE_SIZE,
      );
      hasMore = page.hasMore;
      for (const activity of page.activities) {
        const at = activity.createdAt?.getTime();
        if (at === undefined) continue;
        if (at < from) reachedStart = true;
        else if (at <= to && keep(activity)) collected.push(activity);
      }
    }
    // Defensive: Thndr has been observed newest first; do not rely on it. Only timestamped entries were collected.
    collected.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
    const truncated = hasMore && !reachedStart;
    return {
      market,
      activities: collected,
      page: 1,
      hasMore: truncated,
      range: { from: range.from ?? null, to: range.to ?? null },
      truncated,
      pagesFetched,
    };
  }
}

function parseActivityCategory(raw: string | undefined): ActivityCategory | null {
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'all') return null;
  const value = raw.trim().toUpperCase();
  if (!(ACTIVITY_CATEGORIES as readonly string[]).includes(value)) {
    throw new ValidationError(
      `Unsupported activity category "${raw}". Use one of: ${ACTIVITY_CATEGORIES.join(', ')}`,
    );
  }
  return value as ActivityCategory;
}
