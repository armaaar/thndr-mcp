import { afterEach, describe, expect, it } from 'vitest';
import type * as M from '../../../src/application/market-data/use-cases.js';
import { marketDataTools } from '../../../src/interface/mcp/market-data-tools.js';
import { type ConnectedClient, connect } from '../../support/mcp-client.js';
import { stub } from '../../support/use-case-stub.js';

function useCases() {
  return {
    searchInstruments: stub<M.SearchInstruments>([{ ticker: 'COMI' }]),
    getInstrumentDetails: stub<M.GetInstrumentDetails>({ ticker: 'COMI' }),
    getPriceSnapshot: stub<M.GetPriceSnapshot>({ quotes: [], missing: [] }),
    getPriceHistory: stub<M.GetPriceHistory>({ candles: [] }),
    getMarketDepth: stub<M.GetMarketDepth>({ bids: [], asks: [] }),
    getRecentTrades: stub<M.GetRecentTrades>({ trades: [] }),
    getMarketStatus: stub<M.GetMarketStatus>({ isOpen: true }),
    screenMarket: stub<M.ScreenMarket>({ results: [] }),
  };
}

describe('market data tools', () => {
  let conn: ConnectedClient;
  afterEach(async () => conn?.close());

  it('lists read-only tools', async () => {
    conn = await connect(marketDataTools(useCases()));
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'search_instruments',
      'get_instrument_details',
      'get_price_snapshot',
      'get_price_history',
      'get_market_depth',
      'get_recent_trades',
      'get_market_status',
      'screen_market',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('maps arguments with defaults', async () => {
    const uc = useCases();
    conn = await connect(marketDataTools(uc));

    expect((await conn.call('search_instruments', { query: 'cib' })).json).toEqual({
      results: [{ ticker: 'COMI' }],
    });
    expect(uc.searchInstruments.execute).toHaveBeenCalledWith({ query: 'cib', market: 'egypt', limit: 20 });

    await conn.call('get_instrument_details', { symbol: 'COMI', market: 'us' });
    expect(uc.getInstrumentDetails.execute).toHaveBeenCalledWith({ symbol: 'COMI', market: 'us' });

    await conn.call('get_price_snapshot', { symbols: ['COMI', 'HRHO'] });
    expect(uc.getPriceSnapshot.execute).toHaveBeenCalledWith({ symbols: ['COMI', 'HRHO'], market: 'egypt' });

    await conn.call('get_price_history', { symbol: 'COMI' });
    expect(uc.getPriceHistory.execute).toHaveBeenCalledWith({
      symbol: 'COMI',
      market: 'egypt',
      resolution: '1d',
      bars: undefined,
      from: undefined,
      to: undefined,
    });
    await conn.call('get_price_history', {
      symbol: 'COMI',
      resolution: '1h',
      from: '2026-01-01',
      to: '2026-02-01',
      bars: 5,
    });
    expect(uc.getPriceHistory.execute).toHaveBeenLastCalledWith({
      symbol: 'COMI',
      market: 'egypt',
      resolution: '1h',
      bars: 5,
      from: new Date('2025-12-31T22:00:00.000Z'), // 2026-01-01 00:00 Cairo (UTC+2)
      to: new Date('2026-02-01T21:59:59.999Z'), // end of 2026-02-01 Cairo
    });

    await conn.call('get_market_depth', { symbol: 'COMI' });
    expect(uc.getMarketDepth.execute).toHaveBeenCalledWith({ symbol: 'COMI', market: 'egypt', levels: 10 });

    await conn.call('get_recent_trades', { symbol: 'COMI', before: '9' });
    expect(uc.getRecentTrades.execute).toHaveBeenCalledWith({
      symbol: 'COMI',
      market: 'egypt',
      limit: 50,
      before: '9',
    });

    await conn.call('get_market_status', {});
    expect(uc.getMarketStatus.execute).toHaveBeenCalledWith({ market: 'egypt' });

    await conn.call('screen_market', { sector: 'Banks', min_relative_volume: 200, order: 'asc' });
    expect(uc.screenMarket.execute).toHaveBeenCalledWith({
      market: 'egypt',
      sector: 'Banks',
      minPrice: undefined,
      maxPrice: undefined,
      minChangePercent: undefined,
      maxChangePercent: undefined,
      minValue: undefined,
      minRelativeVolume: 200,
      maxPeRatio: undefined,
      minDividendYield: undefined,
      includeSuspended: false,
      sortBy: 'changePercent',
      order: 'asc',
      limit: 20,
    });
  });

  it('validates dates and enums', async () => {
    const uc = useCases();
    conn = await connect(marketDataTools(uc));
    expect((await conn.call('get_price_history', { symbol: 'COMI', from: 'not-a-date' })).isError).toBe(true);
    expect((await conn.call('get_market_status', { market: 'mars' })).isError).toBe(true);
    expect(uc.getPriceHistory.execute).not.toHaveBeenCalled();
  });
});
