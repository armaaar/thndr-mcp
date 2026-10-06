import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFetch, json, type Responder } from '../../../__tests__/support/fake-fetch';
import { UpstreamError } from '../../../application/errors';
import { ThndrHttpClient } from '../../../data-sources/thndr/http-client';
import { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ThndrPortfolioRepository } from '../portfolio-repository';
import {
  toAccountSnapshot,
  toClosedTrade,
  toOrder,
  toPosition,
  toSellJournalEntry,
} from '../translators/portfolio';

const ID = '11111111-2222-3333-4444-555555555555';
const ID2 = '66666666-7777-8888-9999-000000000000';
const tokenProvider = { getAccessToken: async () => 'T', invalidate: () => {} };

function setup(...responders: Responder[]) {
  const fetch = fakeFetch(...responders);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, tokenProvider, runtimeVersion: '3.8.3' });
  const gateway = new ThndrPortfolioRepository(
    client('https://api.test'),
    client('https://api.test/krakend-thndr-x'),
  );
  const url = (i = 0) => new URL(fetch.calls[i]?.url ?? '');
  return { fetch, gateway, url };
}

const position = {
  asset_id: ID,
  symbol: 'COMI',
  asset_class: 'STOCK',
  currency: 'EGP',
  qty: 100,
  cost_value: '8,000',
  market_price: 90,
  gain_loss: 1_000,
  gain_loss_percentage: 12.5,
};

describe('ThndrPortfolioRepository.getAccount', () => {
  it('maps wallet and portfolio', async () => {
    const { gateway, url, fetch } = setup(() =>
      json({
        purchase_power: 10_000,
        cash_in_holding: 500,
        unsettled_cash: '1000',
        settled_cash: 9_000,
        portfolio: {
          portfolio_value: 9_000,
          total_return: 1_000,
          total_return_prc: 12.5,
          positions: [
            position,
            { symbol: 'GOLD', qty: 2.5, avg_cost: 4_000, market_price: 4_100, unit: 'grams', currency: 2 },
            { symbol: '', qty: 1 },
            { symbol: 'NOQTY' },
            { symbol: 'NEG', qty: -5 },
            null,
          ],
        },
      }),
    );
    const { summary, positions } = await gateway.getAccount('egypt');
    expect(url().pathname).toBe('/market-service/accounts/wallet-and-portfolio');
    expect(url().searchParams.get('market')).toBe('egypt');
    expect(fetch.calls[0]?.headers.authorization).toBe('Bearer T');
    expect(summary).toMatchObject({
      buyingPower: 10_000,
      blockedCash: 500,
      unsettledCash: 1_000,
      settledCash: 9_000,
      availableCash: 9_000,
      portfolioValue: 9_000,
      totalAccountValue: 19_500,
      totalReturn: 1_000,
      totalReturnPercent: 12.5,
      currency: 'EGP',
    });
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({ averageCost: 80, marketValue: 9_000, unrealizedPnl: 1_000 });
    expect(positions[0]?.instrumentId?.value).toBe(ID);
    expect(positions[1]).toMatchObject({
      instrumentId: null,
      assetClass: 'UNKNOWN',
      currency: 'USD',
      unit: 'grams',
      costValue: 10_000,
      marketValue: 10_250,
    });
  });

  it('defaults missing cash fields and sums positions when portfolio value is absent', async () => {
    const { gateway } = setup(() => json({ purchase_power: 100, portfolio: { positions: [position] } }));
    const { summary } = await gateway.getAccount('us');
    expect(summary).toMatchObject({
      blockedCash: 0,
      unsettledCash: 0,
      settledCash: null,
      portfolioValue: 9_000,
      totalReturn: null,
      currency: 'USD',
    });
    const empty = setup(() => json({ purchase_power: 1 }));
    expect((await empty.gateway.getAccount('egypt')).summary.portfolioValue).toBe(0);
  });

  it('rejects payloads without buying power', async () => {
    await expect(setup(() => json({})).gateway.getAccount('egypt')).rejects.toThrow(/purchase_power/);
    await expect(setup(() => json(undefined)).gateway.getAccount('egypt')).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});

describe('row mappers', () => {
  it('reject non-object rows', () => {
    expect(toOrder(null)).toBeNull();
    expect(toClosedTrade(undefined)).toBeNull();
    expect(toSellJournalEntry(null)).toBeNull();
    expect(toPosition(null, 'egypt')).toBeNull();
  });

  it('maps stop-loss-only brackets and non-string leg types', () => {
    const o = toOrder({
      id: 1,
      stock_id: 'COMI',
      order_type: 'SELL',
      amount: 1,
      order_pairs: [{ stop_loss: { type: 3 as never } }],
    });
    expect(o?.brackets.map((b) => [b.kind, b.type])).toEqual([['STOP_LOSS', null]]);
  });

  it('counts unpriced positions as zero when summing the portfolio value', () => {
    const snap = toAccountSnapshot(
      { purchase_power: 1, portfolio: { positions: [{ symbol: 'A', qty: 1 }, position] } },
      'egypt',
    );
    expect(snap.summary.portfolioValue).toBe(9_000);
  });
});

describe('toPosition', () => {
  it('propagates non-domain errors from row mapping', () => {
    const row = {
      ...position,
      get avg_cost(): number {
        throw new TypeError('boom');
      },
    };
    expect(() => toPosition(row, 'egypt')).toThrow(TypeError);
  });
});

describe('ThndrPortfolioRepository.getPosition', () => {
  it('calls krakend and maps the position', async () => {
    const { gateway, url } = setup(() => json(position));
    const p = await gateway.getPosition(AssetId.of(ID), 'egypt');
    expect(url().pathname).toBe(`/krakend-thndr-x/portfolio/v1/position/${ID}`);
    expect(url().searchParams.get('market')).toBe('egypt');
    expect(p?.ticker.value).toBe('COMI');
  });

  it('returns null on 404 (HTTP or krakend envelope)', async () => {
    expect(
      await setup(() => json({ detail: 'nope' }, 404)).gateway.getPosition(AssetId.of(ID), 'egypt'),
    ).toBe(null);
    const envelope = setup(() =>
      json({
        error_security_position: {
          http_status_code: 404,
          http_body: '{"detail":{"msg":"not found","type":"NOT_FOUND"}}',
        },
      }),
    );
    expect(await envelope.gateway.getPosition(AssetId.of(ID), 'egypt')).toBeNull();
  });

  it('rethrows other errors', async () => {
    const envelope = setup(() =>
      json({ error_security_position: { http_status_code: 500, http_body: '{"detail":{"msg":"down"}}' } }),
    );
    await expect(envelope.gateway.getPosition(AssetId.of(ID), 'egypt')).rejects.toThrow(/down/);
    await expect(
      setup(() => json({}, 500)).gateway.getPosition(AssetId.of(ID), 'egypt'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('ThndrPortfolioRepository.getSellableQuantity', () => {
  it('maps settlement buckets and the custodian', async () => {
    const { gateway, url } = setup(() =>
      json({
        qty: 100,
        qty_blocked: 10,
        qty_t0: 20,
        qty_blocked_t0: 0,
        qty_t1: 30,
        qty_blocked_t1: 5,
        qty_settled: 50,
        qty_blocked_settled: 5,
        unsalable_qty: 0,
        qty_blocked_unsalable: 0,
        qty_settled_per_custodian: [{ custodian: 'thn', qty: 10 }, { custodian: 'AUB', qty: 40 }, null],
      }),
    );
    const s = await gateway.getSellableQuantity(AssetId.of(ID), 'egypt');
    expect(url().pathname).toBe(`/market-service/accounts/positions/blocked-quantities/${ID}`);
    expect(s.all).toEqual({ total: 100, blocked: 10, available: 90 });
    expect(s.t1.available).toBe(25);
    expect(s.settled.available).toBe(45);
    expect(s.custodian).toBe('AUB');
  });

  it('defaults to THN when settled shares are elsewhere, null when unknown', async () => {
    const thn = setup(() => json({ qty_settled_per_custodian: [{ custodian: 'OTHER' }] }));
    expect((await thn.gateway.getSellableQuantity(AssetId.of(ID), 'egypt')).custodian).toBe('THN');
    const none = setup(() => json(null));
    const s = await none.gateway.getSellableQuantity(AssetId.of(ID), 'egypt');
    expect(s.custodian).toBeNull();
    expect(s.all.total).toBe(0);
  });
});

const order = {
  id: 123,
  asset_id: ID,
  stock_id: 'COMI',
  order_type: 'buy',
  is_limit: true,
  order_class: 'Bracket',
  amount: 100,
  amount_filled: 40,
  price: 79.5,
  limit_price: 80,
  order_status: 'PENDING',
  order_status_details: 'PARTIALLY_FILLED',
  time_in_force: 'gtc',
  time_in_force_date: '2026-02-01T00:00:00Z',
  execution_type: 'DEFAULT',
  settlement: 'T1',
  order_pairs: [
    {
      pair_id: 'p1',
      take_profit: { id: 7, qty: 100, trigger_price: 90, limit_price: 90, type: 'Limit', status: 'Active' },
      stop_loss: { id: '8', qty: 100, trigger_price: 70, type: 'Market', status: 'Inactive' },
    },
    { pair_id: 'p2', take_profit: { type: 'weird' } },
    null,
  ],
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T11:00:00Z',
};

describe('ThndrPortfolioRepository.listOrders', () => {
  it('sends ThndrX query params and maps orders', async () => {
    const { gateway, url } = setup(() =>
      json({
        data: [
          order,
          { id: 124, reuters_code: 'HRHO', order_type: 'SELL', is_limit: false, amount: '5', price: null },
          { id: 125, stock_id: 'X', order_type: 'HOLD', amount: 1 },
          { id: 126, order_type: 'BUY', amount: 1 },
          { stock_id: 'X', order_type: 'BUY', amount: 1 },
          { id: 127, stock_id: 'X', order_type: 'BUY' },
          { id: 128, stock_id: 'X', order_type: 'BUY', amount: -1 },
          { id: 129, stock_id: 'X', order_type: 7, amount: 1 },
        ],
        has_next: true,
        cursor: 'abc',
      }),
    );
    const page = await gateway.listOrders({
      market: 'egypt',
      status: 'open',
      limit: 20,
      cursor: 'c0',
      instrumentId: AssetId.of(ID),
    });
    expect(url().pathname).toBe('/market-service/v3/orders');
    expect(Object.fromEntries(url().searchParams)).toEqual({
      market: 'egypt',
      status: 'PENDING',
      cursor: 'c0',
      limit: '20',
      sort_order: 'DESC',
      skip_funds: 'true',
      asset_id: ID,
    });
    expect(page.nextCursor).toBe('abc');
    expect(page.orders).toHaveLength(2);
    const [first, second] = page.orders;
    expect(first).toMatchObject({
      id: '123',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 100,
      filledQuantity: 40,
      remainingQuantity: 60,
      price: 80,
      averageFillPrice: 79.5,
      status: 'PENDING',
      statusDetail: 'PARTIALLY_FILLED',
      isOpen: true,
      timeInForce: 'GTC',
      executionType: 'DEFAULT',
      settlement: 'T1',
      orderClass: 'Bracket',
    });
    expect(first?.expiresAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(first?.brackets).toEqual([
      {
        kind: 'TAKE_PROFIT',
        id: '7',
        quantity: 100,
        triggerPrice: 90,
        limitPrice: 90,
        type: 'LIMIT',
        status: 'Active',
      },
      {
        kind: 'STOP_LOSS',
        id: '8',
        quantity: 100,
        triggerPrice: 70,
        limitPrice: null,
        type: 'MARKET',
        status: 'Inactive',
      },
      {
        kind: 'TAKE_PROFIT',
        id: null,
        quantity: null,
        triggerPrice: null,
        limitPrice: null,
        type: null,
        status: null,
      },
    ]);
    expect(second).toMatchObject({
      ticker: expect.objectContaining({ value: 'HRHO' }),
      side: 'SELL',
      type: 'MARKET',
      status: 'UNKNOWN',
      instrumentId: null,
      brackets: [],
    });
  });

  it('omits optional params and stops when there is no next page', async () => {
    const { gateway, url } = setup(() => json({ data: [], has_next: false, cursor: 'zzz' }));
    const page = await gateway.listOrders({ market: 'us', status: 'all', limit: 5, sortOrder: 'ASC' });
    expect(Object.fromEntries(url().searchParams)).toEqual({
      market: 'us',
      limit: '5',
      sort_order: 'ASC',
      skip_funds: 'true',
    });
    expect(page.nextCursor).toBeNull();
    const nothing = setup(() => json(null));
    expect(await nothing.gateway.listOrders({ market: 'egypt', status: 'closed', limit: 1 })).toEqual({
      orders: [],
      nextCursor: null,
    });
    expect(nothing.url().searchParams.get('status')).toBe('CLOSED');
  });
});

describe('ThndrPortfolioRepository returns', () => {
  it('maps realized returns and the chart', async () => {
    const { gateway, url } = setup(
      () => json({ total_returns: '1,500.5', snapshot_date: '2026-01-31' }),
      () =>
        json([
          { snapshot_date: '2026-01-01', total_returns: 100, portfolio_value: 10_000, net_deposits: 9_000 },
          { snapshot_date: null, total_returns: 1 },
          null,
        ]),
    );
    const current = await gateway.getRealizedReturns('egypt');
    expect(url(0).pathname).toBe('/market-service/realized-returns');
    expect(current.totalReturns).toBe(1_500.5);
    expect(current.snapshotDate?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    const chart = await gateway.getReturnsChart('6M', 'egypt');
    expect(url(1).pathname).toBe('/market-service/realized-returns/chart/6M');
    expect(url(1).searchParams.get('market')).toBe('egypt');
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ totalReturns: 100, portfolioValue: 10_000, netDeposits: 9_000 });
  });

  it('tolerates empty payloads', async () => {
    const { gateway } = setup(() => json(null));
    expect(await gateway.getRealizedReturns('egypt')).toEqual({ totalReturns: null, snapshotDate: null });
    expect(await gateway.getReturnsChart('1M', 'egypt')).toEqual([]);
  });
});

const from = new Date('2026-01-01T00:00:00.000Z');
const to = new Date('2026-02-01T00:00:00.000Z');

describe('ThndrPortfolioRepository journal', () => {
  it('maps full trades and paginates by total_count', async () => {
    const { gateway, url } = setup(() =>
      json({
        full_trades: [
          {
            asset_id: ID,
            reuters_code: 'COMI',
            open_date: '2026-01-02',
            close_date: '2026-01-10',
            avg_entry_price: 80,
            close_price: 90,
            volume: 100,
            net_pnl: 950,
            net_pnl_percentage: 11.8,
            duration_days: 8,
          },
          { reuters_code: null },
          null,
        ],
        total_count: 25,
      }),
    );
    const page = await gateway.getClosedTrades({
      market: 'egypt',
      page: 2,
      limit: 10,
      ticker: 'COMI',
      from,
      to,
    });
    expect(url().pathname).toBe('/market-service/trading-journals/full-trades');
    expect(Object.fromEntries(url().searchParams)).toEqual({
      market: 'egypt',
      page: '2',
      limit: '10',
      symbol_code: 'COMI',
      from_date: from.toISOString(),
      to_date: to.toISOString(),
    });
    expect(page.totalCount).toBe(25);
    expect(page.hasMore).toBe(true); // (2-1)*10 + 3 < 25
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      averageEntryPrice: 80,
      averageExitPrice: 90,
      quantity: 100,
      netPnl: 950,
      netPnlPercent: 11.8,
      durationDays: 8,
    });
  });

  it('falls back to full-page pagination without total_count', async () => {
    const full = setup(() => json({ full_trades: [{ reuters_code: 'A' }, { reuters_code: 'B' }] }));
    expect((await full.gateway.getClosedTrades({ market: 'egypt', page: 1, limit: 2 })).hasMore).toBe(true);
    const empty = setup(() => json(null));
    const page = await empty.gateway.getClosedTrades({ market: 'egypt', page: 1, limit: 2 });
    expect(page).toMatchObject({ entries: [], totalCount: null, hasMore: false });
    expect([...empty.url().searchParams.keys()]).toEqual(['market', 'page', 'limit']);
  });

  it('maps grouped sells through krakend', async () => {
    const { gateway, url } = setup(() =>
      json({
        sell_journals: [
          {
            asset_id: ID,
            symbol_code: 'COMI',
            exit_date: '2026-01-10',
            exit_price: 90,
            exit_value: 4_500,
            volume_sold: 50,
            avg_entry_price: 80,
            net_pnl: 480,
            pnl_percentage: 12,
          },
          {},
        ],
        total_count: 2,
      }),
    );
    const page = await gateway.getSellJournal({ market: 'egypt', page: 1, limit: 2 });
    expect(url().pathname).toBe('/krakend-thndr-x/trading-journals/v1/grouped-sells');
    expect(page.hasMore).toBe(true);
    expect(page.totalCount).toBe(2);
    expect(page.entries[0]).toMatchObject({
      ticker: expect.objectContaining({ value: 'COMI' }),
      exitPrice: 90,
      exitValue: 4_500,
      quantitySold: 50,
      netPnlPercent: 12,
    });
    const empty = setup(() => json({}));
    expect((await empty.gateway.getSellJournal({ market: 'egypt', page: 1, limit: 2 })).hasMore).toBe(false);
  });

  it('raises krakend envelope errors on grouped sells', async () => {
    const { gateway } = setup(() =>
      json({ error_partial_sells: { http_status_code: 502, http_body: '{"detail":{"msg":"bad gateway"}}' } }),
    );
    await expect(gateway.getSellJournal({ market: 'egypt', page: 1, limit: 2 })).rejects.toThrow(
      /bad gateway/,
    );
  });

  it('maps trading metrics', async () => {
    const { gateway, url } = setup(() =>
      json({
        overall_stats: {
          total_return_egp: 1_000,
          profit_factor: 1.5,
          expectancy_per_trade_egp: 50,
          win_rate_percentage: 60,
          average_win_egp: 300,
          average_loss_egp: 150,
          number_of_trades: 20,
          average_position_size_egp: 10_000,
          average_duration_days: 5,
        },
        stats_per_symbol: {
          [ID]: { total_return_egp: 700, number_of_trades: 4 },
          [ID2]: null,
        },
      }),
    );
    const m = await gateway.getTradingMetrics({ from, to });
    expect(url().pathname).toBe('/krakend-thndr-x/trading-journals/v1/trading-metrics');
    expect(url().searchParams.get('from_date')).toBe(from.toISOString());
    expect(url().searchParams.has('market')).toBe(false);
    expect(m.overall).toMatchObject({ riskRewardRatio: 2, expectancyR: 0.3333, numberOfTrades: 20 });
    expect(m.perInstrument).toHaveLength(2);
    expect(m.perInstrument[0]).toMatchObject({ totalReturn: 700, numberOfTrades: 4, ticker: null });
    expect(m.perInstrument[1]?.totalReturn).toBeNull();
  });

  it('fills an open end of the range, since Thndr ignores a range with only one bound', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T10:00:00.000Z'), toFake: ['Date'] });
    const { gateway, url } = setup(
      () => json({}),
      () => json({ full_trades: [] }),
      () => json({}),
      () => json({ sell_journals: [] }),
    );
    await gateway.getTradingMetrics({ from });
    expect(url(0).searchParams.get('from_date')).toBe(from.toISOString());
    expect(url(0).searchParams.get('to_date')).toBe('2026-10-06T10:00:00.000Z');
    await gateway.getClosedTrades({ market: 'egypt', page: 1, limit: 10, to });
    expect(url(1).searchParams.get('from_date')).toBe('1970-01-01T00:00:00.000Z');
    expect(url(1).searchParams.get('to_date')).toBe(to.toISOString());
    await gateway.getTradingMetrics({});
    expect(url(2).searchParams.has('from_date')).toBe(false);
    expect(url(2).searchParams.has('to_date')).toBe(false);
    await gateway.getSellJournal({ market: 'egypt', page: 1, limit: 10, from });
    expect(url(3).searchParams.get('to_date')).toBe('2026-10-06T10:00:00.000Z');
  });

  it('tolerates empty metrics', async () => {
    const { gateway, url } = setup(() => json({}));
    const m = await gateway.getTradingMetrics({});
    expect([...url().searchParams.keys()]).toEqual([]);
    expect(m.overall.totalReturn).toBeNull();
    expect(m.perInstrument).toEqual([]);
    const nil = setup(() => json(null));
    expect((await nil.gateway.getTradingMetrics({})).perInstrument).toEqual([]);
  });
});

describe('ThndrPortfolioRepository.listActivities', () => {
  it('maps the statement with the market provider', async () => {
    const { gateway, url } = setup(() =>
      json({
        results: [
          {
            ordering_id: 9,
            activity_type: 'buy_order',
            amount: '-8,000.00',
            created_at: '2026-01-02T10:00:00Z',
            description: 'Order Execution',
            asset_meta: { symbol: 'COMI' },
          },
          { activity_type: null, amount: null, description: '' },
        ],
      }),
    );
    const page = await gateway.listActivities('egypt', 1, 2);
    expect(url().pathname).toBe('/funding-service/account-activities');
    expect(Object.fromEntries(url().searchParams)).toEqual({ provider: 'EGID', page_size: '2', page: '1' });
    expect(page.hasMore).toBe(true);
    expect(page.activities[0]).toMatchObject({
      id: '9',
      type: 'BUY_ORDER',
      category: 'TRADE',
      amount: -8_000,
      description: 'Order Execution',
    });
    expect(page.activities[0]?.ticker?.value).toBe('COMI');
    expect(page.activities[1]).toMatchObject({ id: '', type: 'OTHER', category: 'OTHER', ticker: null });
  });

  it('uses the US provider and detects the last page', async () => {
    const { gateway, url } = setup(() => json({ results: [null] }));
    const page = await gateway.listActivities('us', 3, 10);
    expect(url().searchParams.get('provider')).toBe('ALPACA');
    expect(page).toMatchObject({ activities: [], page: 3, hasMore: false });
    const nil = setup(() => json(null));
    expect((await nil.gateway.listActivities('egypt', 1, 10)).hasMore).toBe(false);
  });
});

describe('ThndrPortfolioRepository savings (read-only)', () => {
  it('maps the clouds balances from krakend', async () => {
    const { gateway, url } = setup(() =>
      json({
        amounts_per_type: { INSTANT_EGP: '5,000', MONTHLY_EGP: 2_000, WEIRD: { nested: true } },
        clouds: [
          {
            id: 7,
            name: 'Rainy day',
            cloud_type: 'INSTANT_EGP',
            amount: '5,000',
            gains: 120.5,
            withdrawable_amount: 4_900,
          },
          null,
          { name: '' },
        ],
        count: 2,
        total_amount: 7_000,
        total_gain: '150.25',
      }),
    );
    const savings = await gateway.getSavings();
    expect(url().href).toBe('https://api.test/krakend-thndr-x/savings/v1/clouds');
    expect(savings).toEqual({
      totalAmount: 7_000,
      totalGain: 150.25,
      count: 2,
      amountsPerType: { INSTANT_EGP: 5_000, MONTHLY_EGP: 2_000 },
      clouds: [
        {
          id: '7',
          name: 'Rainy day',
          type: 'INSTANT_EGP',
          amount: 5_000,
          gains: 120.5,
          withdrawableAmount: 4_900,
        },
        { id: null, name: null, type: null, amount: null, gains: null, withdrawableAmount: null },
      ],
    });
    expect(Object.isFrozen(savings.clouds)).toBe(true);
  });

  it('maps an account without savings and tolerates empty payloads', async () => {
    const { gateway } = setup(
      () => json({ amounts_per_type: {}, clouds: [], count: 0, total_amount: 0, total_gain: 0 }),
      () => json(null),
    );
    expect(await gateway.getSavings()).toEqual({
      totalAmount: 0,
      totalGain: 0,
      count: 0,
      amountsPerType: {},
      clouds: [],
    });
    expect(await gateway.getSavings()).toEqual({
      totalAmount: null,
      totalGain: null,
      count: null,
      amountsPerType: {},
      clouds: [],
    });
  });

  it('maps the yields of each savings product', async () => {
    const { gateway, url } = setup(
      () =>
        json({
          INSTANT_EGP: {
            currently_earning: 17.31,
            last_updated_at: '2026-10-06T15:02:19',
            nominal_yields: {
              daily: 15.97,
              monthly: 16.07,
              quarterly: 16.29,
              semi_annually: 16.62,
              weekly: 15.99,
            },
          },
          MONTHLY_EGP: { currently_earning: '20.26', nominal_yields: null },
          BROKEN: null,
        }),
      () => json(null),
    );
    const yields = await gateway.getSavingsYields();
    expect(url().href).toBe('https://api.test/krakend-thndr-x/savings/v1/clouds-stats');
    expect(yields).toEqual([
      {
        product: 'INSTANT_EGP',
        currentlyEarningPercent: 17.31,
        lastUpdatedAt: '2026-10-06T15:02:19',
        nominalYieldsPercent: {
          daily: 15.97,
          weekly: 15.99,
          monthly: 16.07,
          quarterly: 16.29,
          semiAnnually: 16.62,
        },
      },
      {
        product: 'MONTHLY_EGP',
        currentlyEarningPercent: 20.26,
        lastUpdatedAt: null,
        nominalYieldsPercent: {
          daily: null,
          weekly: null,
          monthly: null,
          quarterly: null,
          semiAnnually: null,
        },
      },
    ]);
    expect(await gateway.getSavingsYields()).toEqual([]);
  });

  it('surfaces krakend backend errors', async () => {
    const error = { error_get_clouds: { http_status_code: 503, http_body: '{"detail":{"msg":"down"}}' } };
    const stats = { error_clouds_stats: { http_status_code: 500, http_body: '' } };
    const { gateway } = setup(
      () => json(error),
      () => json(stats),
    );
    await expect(gateway.getSavings()).rejects.toThrow(/error_get_clouds.*down/);
    await expect(gateway.getSavingsYields()).rejects.toThrow(/error_clouds_stats/);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
