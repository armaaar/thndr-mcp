import { z } from 'zod';
import {
  CANDLE_RESOLUTIONS,
  type Candle,
  type CandleResolution,
  historyWindow,
  RESOLUTION_MS,
} from '../../../domain/market-data/candle';
import { parseMarket } from '../../../domain/market-data/market';
import { parseMarketDate } from '../../../domain/market-data/market-calendar';
import { dateInput, marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = {
  symbol: symbolInput,
  market: marketInput,
  resolution: z.enum(CANDLE_RESOLUTIONS).default('1d').describe('Bar size'),
  bars: z.number().int().min(1).max(2000).optional().describe('Most recent N bars (default 100)'),
  from: dateInput.optional(),
  to: dateInput.optional(),
};

export interface PriceHistory {
  ticker: string;
  resolution: CandleResolution;
  from: string;
  to: string;
  candles: Candle[];
}

export class GetPriceHistory extends Query<typeof input, PriceHistory> {
  readonly name = 'get_price_history';
  readonly title = 'Price history';
  readonly description =
    'Historical OHLCV candles. Give either `bars` (most recent N bars, default 100) or a `from`/`to` range. ' +
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
    const candles = await this.deps.repository.getCandles(instrument.id, resolution, window.from, window.to);
    const sorted = [...candles].sort((a, b) => a.time.getTime() - b.time.getTime());
    return {
      ticker: instrument.ticker.value,
      resolution,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      candles: requestedFrom ? sorted : sorted.slice(-bars),
    };
  }
}
