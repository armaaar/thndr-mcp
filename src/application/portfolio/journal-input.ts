import { z } from 'zod';
import type { JournalQuery } from '../../domain/portfolio/repository';
import { parseMarket } from '../../domain/shared-kernel/market';
import { Ticker } from '../../domain/shared-kernel/ticker';
import { marketInput, pageInput } from '../inputs';
import { requireMarketFeature } from '../market-features';
import { clamp } from '../paging';
import type { Clock } from '../ports/clock';
import type { InputOf } from '../use-case';
import { rangeInput, resolveRange } from './range-input';

/** Input contract shared by the trading-journal queries. */
export const journalInput = {
  market: marketInput,
  symbol: z.string().optional().describe('Only this ticker'),
  ...rangeInput,
  page: pageInput,
  limit: z.number().int().min(1).max(100).default(20),
};

export type JournalInput = InputOf<typeof journalInput>;

/** Builds a validated journal query; date-only bounds are Cairo market days, `period` is a preset range. */
export function journalQuery(params: JournalInput, clock: Clock): JournalQuery {
  const range = resolveRange(params, clock);
  const market = parseMarket(params.market);
  requireMarketFeature(market, 'journal');
  return {
    market,
    page: clamp(params.page, 1, 1, 10_000),
    limit: clamp(params.limit, 20, 1, 100),
    ...range,
    ...(params.symbol ? { ticker: Ticker.of(params.symbol).value } : {}),
  };
}
