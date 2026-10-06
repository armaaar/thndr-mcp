import { z } from 'zod';
import type {
  GetInstrumentDetails,
  GetMarketDepth,
  GetMarketStatus,
  GetPriceHistory,
  GetPriceSnapshot,
  GetRecentTrades,
  ScreenMarket,
  SearchInstruments,
} from '../../application/market-data/use-cases.js';
import { SCREEN_SORT_FIELDS } from '../../application/market-data/use-cases.js';
import { CANDLE_RESOLUTIONS } from '../../domain/market-data/candle.js';
import { MARKETS } from '../../domain/market-data/market.js';
import { type AnyTool, defineTool, READ_ONLY } from './tool.js';

export interface MarketDataUseCases {
  searchInstruments: SearchInstruments;
  getInstrumentDetails: GetInstrumentDetails;
  getPriceSnapshot: GetPriceSnapshot;
  getPriceHistory: GetPriceHistory;
  getMarketDepth: GetMarketDepth;
  getRecentTrades: GetRecentTrades;
  getMarketStatus: GetMarketStatus;
  screenMarket: ScreenMarket;
}

export const market = z.enum(MARKETS).default('egypt').describe('Market: "egypt" (EGX, default) or "us"');
export const symbol = z.string().min(1).describe('Ticker symbol (e.g. "COMI") or Thndr asset id (UUID)');
const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be an ISO-8601 date or datetime')
  .describe('ISO-8601 date/time, e.g. 2026-01-31 or 2026-01-31T10:00:00+02:00');

export function marketDataTools(useCases: MarketDataUseCases): AnyTool[] {
  return [
    defineTool({
      name: 'search_instruments',
      title: 'Search instruments',
      description:
        'Search stocks, ETFs, funds and indices by ticker or company name (English or Arabic). Returns tickers and ' +
        'Thndr asset ids. Call this first when you only know a company name.',
      input: {
        query: z.string().min(1).describe('Ticker or company name'),
        market,
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
      handler: async ({ query, market: m, limit }) => ({
        results: await useCases.searchInstruments.execute({ query, market: m, limit }),
      }),
    }),
    defineTool({
      name: 'get_instrument_details',
      title: 'Instrument details',
      description:
        'Company profile and listing details for one instrument: name, sector, board, currency, tradability, suspension.',
      input: { symbol, market },
      annotations: READ_ONLY,
      handler: ({ symbol: s, market: m }) => useCases.getInstrumentDetails.execute({ symbol: s, market: m }),
    }),
    defineTool({
      name: 'get_price_snapshot',
      title: 'Price snapshot',
      description:
        'Current quote for up to 50 instruments: last price, change, open/high/low, bid/ask, volume, value, daily ' +
        'price limits, 52-week range, P/E, EPS, dividend yield and market cap.',
      input: { symbols: z.array(symbol).min(1).max(50), market },
      annotations: READ_ONLY,
      handler: ({ symbols, market: m }) => useCases.getPriceSnapshot.execute({ symbols, market: m }),
    }),
    defineTool({
      name: 'get_price_history',
      title: 'Price history',
      description:
        'Historical OHLCV candles. Give either `bars` (most recent N bars, default 100) or a `from`/`to` range. ' +
        'History is limited to about 5 years.',
      input: {
        symbol,
        market,
        resolution: z.enum(CANDLE_RESOLUTIONS).default('1d').describe('Bar size'),
        bars: z.number().int().min(1).max(2000).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      },
      annotations: READ_ONLY,
      handler: ({ symbol: s, market: m, resolution, bars, from, to }) =>
        useCases.getPriceHistory.execute({
          symbol: s,
          market: m,
          resolution,
          bars,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        }),
    }),
    defineTool({
      name: 'get_market_depth',
      title: 'Market depth',
      description:
        'Order book (bids and asks aggregated by price level with order counts) and the bid/ask spread.',
      input: { symbol, market, levels: z.number().int().min(1).max(50).default(10) },
      annotations: READ_ONLY,
      handler: ({ symbol: s, market: m, levels }) =>
        useCases.getMarketDepth.execute({ symbol: s, market: m, levels }),
    }),
    defineTool({
      name: 'get_recent_trades',
      title: 'Recent trades (time & sales)',
      description:
        'Latest executed trades for an instrument. Use `before` with the returned nextCursor to page back.',
      input: {
        symbol,
        market,
        limit: z.number().int().min(1).max(200).default(50),
        before: z.string().optional().describe('Cursor from a previous call'),
      },
      annotations: READ_ONLY,
      handler: ({ symbol: s, market: m, limit, before }) =>
        useCases.getRecentTrades.execute({ symbol: s, market: m, limit, before }),
    }),
    defineTool({
      name: 'get_market_status',
      title: 'Market status',
      description:
        "Whether the market is open now, today's session open/close times and the main index levels (EGX30, EGX70…). " +
        'EGX regular session: Sunday–Thursday 10:00–14:30 Africa/Cairo.',
      input: { market },
      annotations: READ_ONLY,
      handler: ({ market: m }) => useCases.getMarketStatus.execute({ market: m }),
    }),
    defineTool({
      name: 'screen_market',
      title: 'Screen the market',
      description:
        'Filter and rank every instrument of a market using the live snapshot — e.g. top gainers ' +
        '(sort_by=changePercent), top losers (order=asc), most active (sort_by=value), unusual volume ' +
        '(min_relative_volume=200), value stocks (max_pe_ratio, min_dividend_yield) or a sector.',
      input: {
        market,
        sector: z.string().optional().describe('Sector name or part of it, e.g. "Banks", "Real Estate"'),
        min_price: z.number().optional(),
        max_price: z.number().optional(),
        min_change_percent: z.number().optional(),
        max_change_percent: z.number().optional(),
        min_value: z.number().optional().describe('Minimum traded value today (EGP)'),
        min_relative_volume: z.number().optional().describe('Volume as % of the 30-day average'),
        max_pe_ratio: z.number().optional(),
        min_dividend_yield: z.number().optional().describe('Percent'),
        include_suspended: z.boolean().default(false),
        sort_by: z.enum(SCREEN_SORT_FIELDS).default('changePercent'),
        order: z.enum(['asc', 'desc']).default('desc'),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.screenMarket.execute({
          market: a.market,
          sector: a.sector,
          minPrice: a.min_price,
          maxPrice: a.max_price,
          minChangePercent: a.min_change_percent,
          maxChangePercent: a.max_change_percent,
          minValue: a.min_value,
          minRelativeVolume: a.min_relative_volume,
          maxPeRatio: a.max_pe_ratio,
          minDividendYield: a.min_dividend_yield,
          includeSuspended: a.include_suspended,
          sortBy: a.sort_by,
          order: a.order,
          limit: a.limit,
        }),
    }),
  ];
}
