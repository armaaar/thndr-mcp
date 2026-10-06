import type { Candle } from './candle';
import { MARKET_TIME_ZONE } from './market-calendar';

/** Trailing periods of {@link pricePerformance}. YTD starts at the last close of the previous calendar year. */
export const PERFORMANCE_PERIODS = ['1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

/**
 * When no close exists on or before a period start (Thndr serves ~5 years of candles, so the 5Y start often falls
 * just before the first one, or on a weekend), the base is the first close at most this many days after the start.
 */
export const BASE_FORWARD_DAYS = 7;

/** Volatility windows, in trading days (daily returns). */
export const VOLATILITY_WINDOWS = { '30D': 30, '90D': 90, '1Y': 252 } as const;
export type VolatilityWindow = keyof typeof VOLATILITY_WINDOWS;

/** Trading days per year used to annualise daily volatility. */
export const TRADING_DAYS_PER_YEAR = 252;

export interface PeriodReturn {
  period: PerformancePeriod;
  /** Calendar day the period starts (Cairo market day). */
  startDate: string;
  /**
   * Day of the base close: the last close on or before `startDate`, else the first close at most
   * {@link BASE_FORWARD_DAYS} days after it; null when history does not reach back that far.
   */
  baseDate: string | null;
  baseClose: number | null;
  /** Close-to-close return in percent; null when history is too short. */
  returnPercent: number | null;
}

export interface Volatility {
  window: VolatilityWindow;
  tradingDays: number;
  /** Sample standard deviation of daily log returns × √252, in percent; null when history is too short. */
  annualisedPercent: number | null;
}

export interface RangeExtremes {
  high: number;
  highDate: string;
  low: number;
  lowDate: string;
}

export interface Drawdown {
  /** Largest peak-to-trough fall of the close, in percent (≤ 0). */
  percent: number;
  peakDate: string;
  troughDate: string;
}

export interface PricePerformance {
  /** Day of the latest close. */
  asOf: string | null;
  lastClose: number | null;
  /** First day of the history used. */
  firstDate: string | null;
  sessions: number;
  returns: PeriodReturn[];
  volatility: Volatility[];
  /** Highest high and lowest low of the daily candles over the last 52 weeks (lows ≤ 0 replaced by the close). */
  week52: RangeExtremes | null;
  /** Over the last year (from the 1Y base close), on closes. */
  maxDrawdown1Y: Drawdown | null;
}

interface Session {
  day: string;
  close: number;
  high: number;
  low: number;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: MARKET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Cairo calendar day (YYYY-MM-DD) of an instant. */
export function marketDay(time: Date): string {
  return dayFormat.format(time);
}

/** Moves a calendar day by whole months and days; month ends clamp (31 Mar − 1 month → 28/29 Feb). */
export function shiftDay(day: string, months: number, days = 0): string {
  const [y = 0, mo = 1, d = 1] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay) + days);
  return target.toISOString().slice(0, 10);
}

function periodStart(period: PerformancePeriod, asOf: string): string {
  switch (period) {
    case '1W':
      return shiftDay(asOf, 0, -7);
    case '1M':
      return shiftDay(asOf, -1);
    case '3M':
      return shiftDay(asOf, -3);
    case '6M':
      return shiftDay(asOf, -6);
    case 'YTD':
      return `${Number(asOf.slice(0, 4)) - 1}-12-31`;
    case '1Y':
      return shiftDay(asOf, -12);
    case '3Y':
      return shiftDay(asOf, -36);
    case '5Y':
      return shiftDay(asOf, -60);
  }
}

/** One session per market day (the last candle of a day wins), oldest first, positive closes only. */
function sessions(candles: readonly Candle[]): Session[] {
  const byDay = new Map<string, Session>();
  for (const c of [...candles].sort((a, b) => a.time.getTime() - b.time.getTime())) {
    if (!(c.close > 0)) continue;
    byDay.set(marketDay(c.time), { day: marketDay(c.time), close: c.close, high: c.high, low: c.low });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Index of the last session on or before `day`, or -1. */
function lastOnOrBefore(series: readonly Session[], day: string): number {
  for (let i = series.length - 1; i >= 0; i--) if ((series[i] as Session).day <= day) return i;
  return -1;
}

/** The base session of a period: the last on or before `start`, else the first within {@link BASE_FORWARD_DAYS} after. */
function baseSession(series: readonly Session[], start: string): Session | undefined {
  const before = series[lastOnOrBefore(series, start)];
  if (before) return before;
  const first = series[0];
  return first && first.day <= shiftDay(start, 0, BASE_FORWARD_DAYS) ? first : undefined;
}

/** Sample standard deviation (n − 1). */
function stdev(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

/**
 * Trailing performance statistics from daily candles: close-to-close returns per period (base = last close on or
 * before the period start, else the first close within a week after it), annualised historical volatility, the 52-week range and the 1-year maximum drawdown.
 */
export function pricePerformance(candles: readonly Candle[]): PricePerformance {
  const series = sessions(candles);
  const last = series.at(-1);
  if (!last) {
    return {
      asOf: null,
      lastClose: null,
      firstDate: null,
      sessions: 0,
      returns: [],
      volatility: [],
      week52: null,
      maxDrawdown1Y: null,
    };
  }
  const returns = PERFORMANCE_PERIODS.map((period): PeriodReturn => {
    const startDate = periodStart(period, last.day);
    const base = baseSession(series, startDate);
    return {
      period,
      startDate,
      baseDate: base?.day ?? null,
      baseClose: base?.close ?? null,
      returnPercent: base ? (last.close / base.close - 1) * 100 : null,
    };
  });

  const logReturns = series.slice(1).map((s, i) => Math.log(s.close / (series[i] as Session).close));
  const volatility = (Object.entries(VOLATILITY_WINDOWS) as Array<[VolatilityWindow, number]>).map(
    ([window, tradingDays]): Volatility => ({
      window,
      tradingDays,
      annualisedPercent:
        logReturns.length >= tradingDays
          ? stdev(logReturns.slice(-tradingDays)) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100
          : null,
    }),
  );

  const yearStart = shiftDay(last.day, -12);
  const lastYear = series.filter((s) => s.day > yearStart);
  let week52: RangeExtremes | null = null;
  for (const s of lastYear) {
    // A low ≤ 0 is a bad bar (closes are positive): fall back to the session's close.
    const low = s.low > 0 ? s.low : s.close;
    if (!week52) week52 = { high: s.high, highDate: s.day, low, lowDate: s.day };
    if (s.high > week52.high) Object.assign(week52, { high: s.high, highDate: s.day });
    if (low < week52.low) Object.assign(week52, { low, lowDate: s.day });
  }

  const from = Math.max(lastOnOrBefore(series, yearStart), 0);
  const window = series.slice(from);
  let maxDrawdown1Y: Drawdown | null = null;
  if (window.length >= 2) {
    let peak = window[0] as Session;
    maxDrawdown1Y = { percent: 0, peakDate: peak.day, troughDate: peak.day };
    for (const s of window) {
      if (s.close > peak.close) peak = s;
      const fall = (s.close / peak.close - 1) * 100;
      if (fall < maxDrawdown1Y.percent)
        maxDrawdown1Y = { percent: fall, peakDate: peak.day, troughDate: s.day };
    }
  }

  return {
    asOf: last.day,
    lastClose: last.close,
    firstDate: (series[0] as Session).day,
    sessions: series.length,
    returns,
    volatility,
    week52,
    maxDrawdown1Y,
  };
}
