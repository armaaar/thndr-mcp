import { z } from 'zod';
import { type Market, parseMarket } from '../../../domain/market-data/market';
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityPage,
} from '../../../domain/portfolio/activity';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { marketInput, pageInput } from '../../inputs';
import { clamp } from '../../paging';
import { type InputOf, Query } from '../../use-case';
import type { PortfolioDependencies } from '../dependencies';

const input = {
  market: marketInput,
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  page: pageInput,
  pageSize: z.number().int().min(1).max(100).default(20),
};

export type AccountActivityResult = ActivityPage & { market: Market };

export class ListAccountActivity extends Query<typeof input, AccountActivityResult> {
  readonly name = 'get_account_activity';
  readonly title = 'Account activity';
  readonly description =
    'Cash ledger: deposits, withdrawals, order settlements, dividends, fees and transfers.';
  readonly context = 'portfolio';
  readonly input = input;

  constructor(private readonly deps: PortfolioDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<AccountActivityResult> {
    const market = parseMarket(params.market);
    const category = parseActivityCategory(params.category);
    const page = clamp(params.page, 1, 1, 10_000);
    const result = await this.deps.repository.listActivities(
      market,
      page,
      clamp(params.pageSize, 20, 1, 100),
    );
    return {
      market,
      ...result,
      // Thndr has no server-side filter we can rely on: filter the fetched page.
      activities: category ? result.activities.filter((a) => a.category === category) : result.activities,
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
