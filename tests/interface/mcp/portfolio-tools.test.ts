import { afterEach, describe, expect, it } from 'vitest';
import type * as P from '../../../src/application/portfolio/use-cases.js';
import { portfolioTools } from '../../../src/interface/mcp/portfolio-tools.js';
import { type ConnectedClient, connect } from '../../support/mcp-client.js';
import { stub } from '../../support/use-case-stub.js';

function useCases() {
  return {
    getAccountSummary: stub<P.GetAccountSummary>({ buyingPower: 1 }),
    getPositions: stub<P.GetPositions>({ positions: [] }),
    getPosition: stub<P.GetPosition>({ held: false }),
    listOrders: stub<P.ListOrders>({ orders: [] }),
    getRealizedReturns: stub<P.GetRealizedReturns>({ series: [] }),
    getClosedTrades: stub<P.GetClosedTrades>({ items: [] }),
    getSellJournal: stub<P.GetSellJournal>({ items: [] }),
    getTradingMetrics: stub<P.GetTradingMetrics>({ overall: {} }),
    listAccountActivity: stub<P.ListAccountActivity>({ activities: [] }),
  };
}

describe('portfolio tools', () => {
  let conn: ConnectedClient;
  afterEach(async () => conn?.close());

  it('are all read-only and none can enter orders', async () => {
    conn = await connect(portfolioTools(useCases()));
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'get_account_summary',
      'get_account_positions',
      'get_position',
      'get_account_orders',
      'get_realized_returns',
      'get_closed_trades',
      'get_sell_journal',
      'get_trading_metrics',
      'get_account_activity',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('maps arguments to use cases', async () => {
    const uc = useCases();
    conn = await connect(portfolioTools(uc));

    expect((await conn.call('get_account_summary', {})).json).toEqual({ buyingPower: 1 });
    expect(uc.getAccountSummary.execute).toHaveBeenCalledWith({ market: 'egypt' });

    await conn.call('get_account_positions', {});
    expect(uc.getPositions.execute).toHaveBeenCalledWith({
      market: 'egypt',
      sortBy: 'marketValue',
      order: 'desc',
    });

    await conn.call('get_position', { symbol: 'COMI', include_sellable: true });
    expect(uc.getPosition.execute).toHaveBeenCalledWith({
      symbol: 'COMI',
      market: 'egypt',
      includeSellable: true,
    });

    await conn.call('get_account_orders', { status: 'open', cursor: 'c' });
    expect(uc.listOrders.execute).toHaveBeenCalledWith({
      market: 'egypt',
      status: 'open',
      symbol: undefined,
      limit: 20,
      cursor: 'c',
      oldestFirst: false,
    });

    await conn.call('get_realized_returns', { interval: '1Y' });
    expect(uc.getRealizedReturns.execute).toHaveBeenCalledWith({ market: 'egypt', interval: '1Y' });

    await conn.call('get_closed_trades', { from: '2026-01-01', symbol: 'COMI' });
    expect(uc.getClosedTrades.execute).toHaveBeenCalledWith({
      market: 'egypt',
      symbol: 'COMI',
      from: new Date('2025-12-31T22:00:00.000Z'),
      to: undefined,
      page: 1,
      limit: 20,
    });

    await conn.call('get_sell_journal', { to: '2026-02-01', page: 2 });
    expect(uc.getSellJournal.execute).toHaveBeenCalledWith({
      market: 'egypt',
      from: undefined,
      to: new Date('2026-02-01T21:59:59.999Z'),
      page: 2,
      limit: 20,
    });

    await conn.call('get_trading_metrics', { from: '2026-01-01', to: '2026-03-01' });
    expect(uc.getTradingMetrics.execute).toHaveBeenCalledWith({
      market: 'egypt',
      from: new Date('2025-12-31T22:00:00.000Z'),
      to: new Date('2026-03-01T21:59:59.999Z'),
    });
    await conn.call('get_trading_metrics', {});
    expect(uc.getTradingMetrics.execute).toHaveBeenLastCalledWith({
      market: 'egypt',
      from: undefined,
      to: undefined,
    });

    await conn.call('get_account_activity', { page_size: 5 });
    expect(uc.listAccountActivity.execute).toHaveBeenCalledWith({
      market: 'egypt',
      category: undefined,
      page: 1,
      pageSize: 5,
    });
  });

  it('rejects invalid input', async () => {
    const uc = useCases();
    conn = await connect(portfolioTools(uc));
    expect((await conn.call('get_account_orders', { status: 'weird' })).isError).toBe(true);
    expect((await conn.call('get_closed_trades', { from: 'yesterday-ish' })).isError).toBe(true);
    expect(uc.listOrders.execute).not.toHaveBeenCalled();
  });
});
