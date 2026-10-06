import type { AssetId } from '../market-data/asset-id.js';
import { ValidationError } from '../shared/errors.js';
import { roundTo } from '../shared/guards.js';
import type { Ticker } from '../shared/ticker.js';

/** A round trip (entry → full exit) from the trading journal. */
export interface ClosedTrade {
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
  readonly averageEntryPrice: number | null;
  readonly averageExitPrice: number | null;
  readonly quantity: number | null;
  readonly netPnl: number | null;
  readonly netPnlPercent: number | null;
  readonly durationDays: number | null;
}

/** One (possibly partial) sell, grouped by the journal. */
export interface SellJournalEntry {
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly exitedAt: Date | null;
  readonly exitPrice: number | null;
  readonly exitValue: number | null;
  readonly quantitySold: number | null;
  readonly averageEntryPrice: number | null;
  readonly netPnl: number | null;
  readonly netPnlPercent: number | null;
}

export interface JournalPage<T> {
  readonly entries: readonly T[];
  readonly totalCount: number | null;
  readonly page: number;
  readonly hasMore: boolean;
}

export interface OverallTradingStats {
  readonly totalReturn: number | null;
  readonly profitFactor: number | null;
  readonly expectancyPerTrade: number | null;
  readonly winRatePercent: number | null;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly numberOfTrades: number | null;
  readonly averagePositionSize: number | null;
  readonly averageDurationDays: number | null;
  /** `average_win / |average_loss|` (ThndrX "risk/reward"). */
  readonly riskRewardRatio: number | null;
  /** `expectancy_per_trade / |average_loss|` (expectancy in R multiples). */
  readonly expectancyR: number | null;
}

export interface InstrumentTradingStats {
  readonly instrumentId: AssetId | null;
  /** Filled in by the application when the instrument can be resolved. */
  readonly ticker: Ticker | null;
  readonly totalReturn: number | null;
  readonly totalPnlPercent: number | null;
  readonly winRatePercent: number | null;
  readonly numberOfTrades: number | null;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly averagePositionSize: number | null;
}

export interface TradingMetrics {
  readonly overall: OverallTradingStats;
  readonly perInstrument: readonly InstrumentTradingStats[];
}

/** Divides by the magnitude of the average loss; null when either side is unknown or the loss is zero. */
export function perUnitOfLoss(value: number | null, averageLoss: number | null): number | null {
  if (value === null || averageLoss === null || averageLoss === 0) return null;
  return roundTo(value / Math.abs(averageLoss), 4);
}

export type OverallTradingStatsInput = Omit<OverallTradingStats, 'riskRewardRatio' | 'expectancyR'>;

export function createOverallTradingStats(input: OverallTradingStatsInput): OverallTradingStats {
  return Object.freeze({
    ...input,
    riskRewardRatio: perUnitOfLoss(input.averageWin, input.averageLoss),
    expectancyR: perUnitOfLoss(input.expectancyPerTrade, input.averageLoss),
  });
}

export interface DateRange {
  readonly from?: Date;
  readonly to?: Date;
}

/** Validates an optional journal date range (both ends optional; "all time" when omitted). */
export function journalRange(from: Date | undefined, to: Date | undefined, now: Date): DateRange {
  for (const date of [from, to]) {
    if (date && Number.isNaN(date.getTime())) throw new ValidationError('Journal dates must be valid');
  }
  if (from && to && from.getTime() >= to.getTime()) {
    throw new ValidationError('Journal "from" must be before "to"');
  }
  if (from && from.getTime() > now.getTime()) throw new ValidationError('Journal "from" is in the future');
  return Object.freeze({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
}
