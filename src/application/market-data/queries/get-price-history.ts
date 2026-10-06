import { z } from 'zod';
import {
  CANDLE_RESOLUTIONS,
  type Candle,
  type CandleResolution,
  historyWindow,
  RESOLUTION_MS,
} from '../../../domain/market-data/candle';
import {
  type CloseGranularity,
  type ClosePoint,
  type CloseSpan,
  closeGranularity,
  spanCovering,
} from '../../../domain/market-data/close-series';
import { parseMarketDate } from '../../../domain/market-data/market-calendar';
import { type Market, marketSupports, parseMarket } from '../../../domain/shared-kernel/market';
import { dateInput, marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = {
  symbol: symbolInput,
  market: marketInput,
  resolution: z
    .enum(CANDLE_RESOLUTIONS)
    .default('1d')
    .describe(
      'Bar size (Egypt candles; elsewhere it only sizes the window — Thndr picks the spacing of closes)',
    ),
  bars: z.number().int().min(1).max(2000).optional().describe('Most recent N bars (default 100)'),
  from: dateInput.optional(),
  to: dateInput.optional(),
};

interface PriceHistoryBase {
  market: Market;
  ticker: string;
  from: string;
  to: string;
}

/** Egypt: OHLCV candles at the requested resolution. */
export interface CandleHistory extends PriceHistoryBase {
  kind: 'candles';
  resolution: CandleResolution;
  candles: Candle[];
}

/**
 * Other markets: closing prices only (Thndr serves no OHLC there). `granularity` is the spacing Thndr chose for the
 * span that covers the window; no open, high, low or volume is derived.
 */
export interface CloseHistory extends PriceHistoryBase {
  kind: 'closes';
  /** The resolution asked for; it sized the window but does not set the spacing of the points. */
  requestedResolution: CandleResolution;
  /** Thndr's chart span used (`1d`, `1w`, `1M`, `6M`, `1y`, `2y`, `all`). */
  span: CloseSpan;
  granularity: CloseGranularity;
  points: ClosePoint[];
  note: string;
}

export type PriceHistory = CandleHistory | CloseHistory;

const CLOSES_NOTE =
  'Closing prices only: Thndr serves no OHLC candles for this market. The spacing of the points (granularity) is ' +
  'fixed by Thndr per span — e.g. hourly for a week, daily for a month, weekly for the full history — whatever ' +
  'resolution was asked.';

export class GetPriceHistory extends Query<typeof input, PriceHistory> {
  readonly name = 'get_price_history';
  readonly title = 'Price history';
  readonly description =
    'All markets. Egypt: historical OHLCV candles (`kind: "candles"`). US, UAE and other instruments: closing prices ' +
    'only (`kind: "closes"`, `points: [{time, close}]`, spacing chosen by Thndr: hourly for a week, daily for a ' +
    'month, weekly for the full history). Give either `bars` (most recent N, default 100) or a `from`/`to` range. ' +
    'History is limited to about 5 years.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<PriceHistory> {
    const resolution = params.resolution ?? '1d';
    const now = this.deps.clock.now();
    const requestedFrom = parseMarketDate(params.from, 'start');
    const to = parseMarketDate(params.to, 'end') ?? now;
    const bars = Math.min(Math.max(params.bars ?? 100, 1), 2000);
    // Markets are closed most of the time; over-fetch the window for intraday bars, then trim to `bars`.
    const span =
      RESOLUTION_MS[resolution] * bars * (resolution.endsWith('min') || resolution === '1h' ? 4 : 1.6);
    const window = historyWindow(requestedFrom ?? new Date(to.getTime() - span), to, now);
    const instrument = await this.deps.resolver.resolve(params.symbol, parseMarket(params.market));
    const base = {
      market: instrument.market,
      ticker: instrument.ticker.value,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
    if (!marketSupports(instrument.market, 'candles')) {
      const closeSpan = spanCovering(window.from, now);
      const series = await this.deps.repository.getCloses(instrument.id, instrument.market, closeSpan);
      // A range keeps the points inside it; `bars` keeps the latest N up to `to` (a span may start before the
      // estimated window, e.g. the last session of `1d` on a weekend).
      const upToEnd = [...series]
        .filter((p) => p.time <= window.to)
        .sort((a, b) => a.time.getTime() - b.time.getTime());
      const points = requestedFrom ? upToEnd.filter((p) => p.time >= window.from) : upToEnd.slice(-bars);
      const first = points[0];
      return {
        kind: 'closes',
        ...base,
        from: !requestedFrom && first && first.time < window.from ? first.time.toISOString() : base.from,
        requestedResolution: resolution,
        span: closeSpan,
        granularity: closeGranularity(series),
        points,
        note: CLOSES_NOTE,
      };
    }
    const candles = await this.deps.repository.getCandles(instrument.id, resolution, window.from, window.to);
    const sorted = [...candles].sort((a, b) => a.time.getTime() - b.time.getTime());
    return {
      kind: 'candles',
      ...base,
      resolution,
      candles: requestedFrom ? sorted : sorted.slice(-bars),
    };
  }
}
