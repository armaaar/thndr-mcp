import {
  type CloseGranularity,
  type ClosePoint,
  type CloseSpan,
  closeGranularity,
  mergeCloseSeries,
} from '../../../domain/market-data/close-series';
import type { Instrument } from '../../../domain/market-data/instrument';
import {
  BASE_FORWARD_DAYS,
  closePerformance,
  type Drawdown,
  MAX_DAILY_GAP_DAYS,
  marketDay,
  type PeriodReturn,
  type PricePerformance,
  pricePerformance,
  type RangeExtremes,
  type Volatility,
} from '../../../domain/market-data/performance';
import type { YearlyReturn } from '../../../domain/market-data/research';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { roundTo } from '../../../domain/shared-kernel/guards';
import { marketSupports, parseMarket } from '../../../domain/shared-kernel/market';
import { FeatureDisabledError, NotFoundError, UpstreamError } from '../../errors';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { symbol: symbolInput, market: marketInput };

/**
 * 5 years plus a margin, so the 5Y base close (on or before the start day) is in the window when Thndr has it; Thndr
 * serves about 5 years, so the 5Y base is often the first close after the start instead (see `BASE_FORWARD_DAYS`).
 */
const LOOKBACK_YEARS = 5;
const LOOKBACK_MARGIN_DAYS = 10;

export interface PricePerformanceView {
  ticker: string;
  name: string;
  currency: string | null;
  /** Day of the latest daily close. */
  asOf: string | null;
  lastClose: number | null;
  returns: PeriodReturn[];
  volatility: Volatility[];
  week52: RangeExtremes | null;
  maxDrawdown1Y: Drawdown | null;
  /** Thndr's own one-year return (asset details), for reference; null when Thndr gives none or fails. */
  thndrOneYearReturn: YearlyReturn | null;
  history: {
    firstDate: string | null;
    sessions: number;
    /** `1d`: Egypt's daily candles. `closes`: Thndr's closing-price series (other markets: no candles). */
    resolution: '1d' | 'closes';
    /** Closes only: the series joined, finest first, with the spacing Thndr gave each. */
    sources?: CloseSource[];
  };
  method: string;
  notes?: string[];
}

const METHOD =
  'Computed from Thndr’s daily candles (up to ~5 years). Returns are close to close; the base is the last close on ' +
  'or before the period start (YTD: the last close of the previous year), else the first close at most ' +
  `${BASE_FORWARD_DAYS} days after the start (Thndr’s ~5 years of history often begin just after the 5Y start), ` +
  'so check each return’s baseDate; null when history does not reach back that far. ' +
  'Volatility is the sample standard deviation of daily log returns over the last 30, 90 and 252 sessions × √252, ' +
  'in percent. The 52-week range uses daily highs and lows; the maximum drawdown uses closes from the 1Y base. ' +
  'thndrOneYearReturn is Thndr’s own figure and may differ (Thndr’s method is not published).';

/** One closing-price series used by the computation. */
export interface CloseSource {
  span: CloseSpan;
  granularity: CloseGranularity;
  firstDate: string | null;
  points: number;
}

/** Spans joined for markets without candles, finest first: daily recent closes, then the weekly full history. */
const CLOSE_SPANS_USED: readonly CloseSpan[] = ['1M', '1y', 'all'];

const CLOSES_METHOD =
  'Computed from Thndr’s closing prices (this market has no candles): its 1M, 1Y and full-history series joined, ' +
  'finest first — each `history.sources` entry gives the spacing Thndr used (daily recent closes, weekly older ' +
  'ones), so long-period bases may be a weekly close. Returns are close to close; the base is the last close on or ' +
  `before the period start, else the first close at most ${BASE_FORWARD_DAYS} days after it; null when history ` +
  'does not reach back that far. Volatility uses only the trailing run of daily closes (consecutive closes at most ' +
  `${MAX_DAILY_GAP_DAYS} days apart): the sample standard deviation of daily log returns × √252, in percent, null ` +
  'when that run is shorter than the window. The 52-week high/low are the highest and lowest CLOSE (no intraday ' +
  'range is available); the maximum drawdown uses closes from the 1Y base. thndrOneYearReturn is Thndr’s own ' +
  'figure and may differ.';

const r2 = (value: number | null) => (value === null ? null : roundTo(value, 2));
/** Thndr's daily candles carry adjusted prices with many decimals. */
const r4 = (value: number | null) => (value === null ? null : roundTo(value, 4));

export class GetPricePerformance extends Query<typeof input, PricePerformanceView> {
  readonly name = 'get_price_performance';
  readonly title = 'Price performance';
  readonly description =
    'All markets: trailing performance of one instrument — returns over 1W, 1M, 3M, 6M, YTD, 1Y, 3Y and 5Y, ' +
    'annualised historical volatility (30-day, 90-day, 1-year), the 52-week high/low, the 1-year maximum drawdown, ' +
    'and Thndr’s own one-year return. Egypt: from daily candles. US, UAE and others: from Thndr’s closing prices ' +
    '(daily recent closes, weekly older ones; the 52-week range is of closes) — see `history` and `method`.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PricePerformanceView> {
    const instrument = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    const [series, yearly] = await Promise.all([this.series(instrument), this.yearlyReturn(instrument.id)]);
    const { stats } = series;
    return {
      ticker: instrument.ticker.value,
      name: instrument.name,
      currency: instrument.currency,
      asOf: stats.asOf,
      lastClose: r4(stats.lastClose),
      returns: stats.returns.map((r) => ({
        ...r,
        baseClose: r4(r.baseClose),
        returnPercent: r2(r.returnPercent),
      })),
      volatility: stats.volatility.map((v) => ({ ...v, annualisedPercent: r2(v.annualisedPercent) })),
      week52: stats.week52 && {
        ...stats.week52,
        high: roundTo(stats.week52.high, 4),
        low: roundTo(stats.week52.low, 4),
      },
      maxDrawdown1Y: stats.maxDrawdown1Y && {
        ...stats.maxDrawdown1Y,
        percent: roundTo(stats.maxDrawdown1Y.percent, 2),
      },
      thndrOneYearReturn: yearly.value,
      history: {
        firstDate: stats.firstDate,
        sessions: stats.sessions,
        resolution: series.sources ? 'closes' : '1d',
        ...(series.sources ? { sources: series.sources } : {}),
      },
      method: series.sources ? CLOSES_METHOD : METHOD,
      ...(yearly.failed
        ? {
            notes: [
              `Thndr’s one-year return could not be loaded (${yearly.failed}); it is only a reference figure.`,
            ],
          }
        : {}),
    };
  }

  /** Egypt: ~5 years of daily candles. Elsewhere: Thndr's close series of several spans, joined finest first. */
  private async series(
    instrument: Instrument,
  ): Promise<{ stats: PricePerformance; sources?: CloseSource[] }> {
    if (!marketSupports(instrument.market, 'candles')) {
      const all = await Promise.all(
        CLOSE_SPANS_USED.map((span) =>
          this.deps.repository.getCloses(instrument.id, instrument.market, span),
        ),
      );
      const sources = CLOSE_SPANS_USED.map((span, i): CloseSource => {
        const points = all[i] as ClosePoint[];
        const first = points.reduce<Date | null>((min, p) => (min && min <= p.time ? min : p.time), null);
        return {
          span,
          granularity: closeGranularity(points),
          firstDate: first ? marketDay(first) : null,
          points: points.length,
        };
      });
      return { stats: closePerformance(mergeCloseSeries(...all)), sources };
    }
    const to = this.deps.clock.now();
    const from = new Date(to.getTime());
    from.setUTCFullYear(from.getUTCFullYear() - LOOKBACK_YEARS);
    from.setUTCDate(from.getUTCDate() - LOOKBACK_MARGIN_DAYS);
    return { stats: pricePerformance(await this.deps.repository.getCandles(instrument.id, '1d', from, to)) };
  }

  /** Thndr's reference figure: a failure must not cost the whole answer. */
  private async yearlyReturn(id: AssetId): Promise<{ value: YearlyReturn | null; failed?: string }> {
    try {
      return { value: await this.deps.research.getYearlyReturn(id) };
    } catch (error) {
      if (
        error instanceof UpstreamError ||
        error instanceof NotFoundError ||
        error instanceof FeatureDisabledError
      )
        return { value: null, failed: error.message };
      throw error;
    }
  }
}
