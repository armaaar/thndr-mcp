import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../src/application/errors.js';
import { InstrumentResolver } from '../../../src/application/market-data/instrument-resolver.js';
import {
  GetAccountSummary,
  GetClosedTrades,
  GetPosition,
  GetPositions,
  GetRealizedReturns,
  GetSellJournal,
  GetTradingMetrics,
  ListAccountActivity,
  ListOrders,
  type PortfolioDependencies,
} from '../../../src/application/portfolio/use-cases.js';
import type { MarketDataGateway } from '../../../src/application/ports/market-data.js';
import type { PortfolioGateway } from '../../../src/application/ports/portfolio.js';
import { AssetId } from '../../../src/domain/market-data/asset-id.js';
import type { Instrument } from '../../../src/domain/market-data/instrument.js';
import { createAccountSummary } from '../../../src/domain/portfolio/account-summary.js';
import { createAccountActivity } from '../../../src/domain/portfolio/activity.js';
import {
  createOverallTradingStats,
  type InstrumentTradingStats,
} from '../../../src/domain/portfolio/journal.js';
import { createOrder, type Order } from '../../../src/domain/portfolio/order.js';
import { createPosition, type Position } from '../../../src/domain/portfolio/position.js';
import { quantityBucket } from '../../../src/domain/portfolio/sellable-quantity.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';
import { Ticker } from '../../../src/domain/shared/ticker.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const clock = { now: () => NOW };
const COMI_ID = '11111111-2222-3333-4444-555555555555';
const HRHO_ID = '66666666-7777-8888-9999-000000000000';
const UNKNOWN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function instrument(id: string, ticker: string): Instrument {
  return {
    id: AssetId.of(id),
    ticker: Ticker.of(ticker),
    name: ticker,
    assetClass: 'STOCK',
    market: 'egypt',
    currency: 'EGP',
    sector: null,
    board: 'NOPL',
    tradable: true,
    suspended: false,
    priceDecimals: 2,
  };
}

const instruments = [instrument(COMI_ID, 'COMI'), instrument(HRHO_ID, 'HRHO')];

function marketData(): MarketDataGateway {
  return {
    searchInstruments: vi.fn(async (query: string) => instruments.filter((i) => i.ticker.value === query)),
    getInstrument: vi.fn(async (id: AssetId) => {
      const found = instruments.find((i) => i.id.equals(id));
      if (!found) throw new NotFoundError('no such asset');
      return found;
    }),
    getMarketQuotes: vi.fn(),
    getCandles: vi.fn(),
    getOrderBook: vi.fn(),
    getRecentTrades: vi.fn(),
    getMarketSession: vi.fn(),
    getMarketIndicators: vi.fn(),
  } as unknown as MarketDataGateway;
}

function position(ticker: string, marketPrice: number | null, overrides: Partial<Position> = {}): Position {
  return {
    ...createPosition({
      instrumentId: null,
      ticker: Ticker.of(ticker),
      assetClass: 'STOCK',
      currency: 'EGP',
      quantity: 100,
      averageCost: 50,
      costValue: null,
      marketPrice,
      unrealizedPnl: null,
      unrealizedPnlPercent: null,
    }),
    ...overrides,
  };
}

const summary = createAccountSummary({
  buyingPower: 1_000,
  blockedCash: 0,
  unsettledCash: 200,
  settledCash: null,
  portfolioValue: 10_000,
  totalReturn: 500,
  totalReturnPercent: 5,
  currency: 'EGP',
});

function order(id: string): Order {
  return createOrder({
    id,
    instrumentId: null,
    ticker: Ticker.of('COMI'),
    side: 'BUY',
    type: 'LIMIT',
    quantity: 1,
    filledQuantity: null,
    price: 1,
    limitPrice: null,
    status: 'COMPLETED',
    statusDetail: 'FULFILLED',
    timeInForce: null,
    expiresAt: null,
    executionType: null,
    settlement: null,
    orderClass: null,
    brackets: [],
    createdAt: null,
    updatedAt: null,
  });
}

function stats(
  id: string | null,
  totalReturn: number | null,
  ticker: Ticker | null = null,
): InstrumentTradingStats {
  return {
    instrumentId: id ? AssetId.of(id) : null,
    ticker,
    totalReturn,
    totalPnlPercent: null,
    winRatePercent: null,
    numberOfTrades: null,
    averageWin: null,
    averageLoss: null,
    averagePositionSize: null,
  };
}

function setup(overrides: Partial<PortfolioGateway> = {}) {
  const gateway: PortfolioGateway = {
    getAccount: vi.fn(async () => ({
      summary,
      positions: [position('COMI', 60), position('HRHO', 30), position('ZERO', null)],
    })),
    getPosition: vi.fn(async () => position('COMI', 60)),
    getSellableQuantity: vi.fn(async () => ({
      all: quantityBucket(100, 0),
      t0: quantityBucket(0, 0),
      t1: quantityBucket(0, 0),
      settled: quantityBucket(100, 0),
      unsalable: quantityBucket(0, 0),
      custodian: 'THN' as const,
    })),
    listOrders: vi.fn(async () => ({ orders: [], nextCursor: null })),
    getRealizedReturns: vi.fn(async () => ({ totalReturns: 300, snapshotDate: NOW })),
    getReturnsChart: vi.fn(async () => [
      { date: new Date('2026-05-02'), totalReturns: 300, portfolioValue: 11_000 },
      { date: new Date('2026-05-01'), totalReturns: 100, portfolioValue: 10_000 },
    ]),
    getClosedTrades: vi.fn(async () => ({ entries: [], totalCount: 0, page: 1, hasMore: false })),
    getSellJournal: vi.fn(async () => ({ entries: [], totalCount: 0, page: 1, hasMore: false })),
    getTradingMetrics: vi.fn(),
    listActivities: vi.fn(),
    ...overrides,
  };
  const md = marketData();
  const deps: PortfolioDependencies = { gateway, resolver: new InstrumentResolver(md), clock };
  return { gateway, deps, md };
}

describe('GetAccountSummary', () => {
  it('returns the summary with market and position count', async () => {
    const { deps, gateway } = setup();
    const out = await new GetAccountSummary(deps).execute({});
    expect(gateway.getAccount).toHaveBeenCalledWith('egypt');
    expect(out).toMatchObject({
      market: 'egypt',
      availableCash: 800,
      totalAccountValue: 11_000,
      positions: 3,
    });
  });
});

describe('GetPositions', () => {
  it('sorts by market value (desc) and attaches weights by default', async () => {
    const { deps } = setup();
    const out = await new GetPositions(deps).execute({ market: 'EGX' });
    expect(out.positions.map((p) => [p.ticker.value, p.weightPercent])).toEqual([
      ['COMI', 60],
      ['HRHO', 30],
      ['ZERO', 0],
    ]);
    expect(out).toMatchObject({ market: 'egypt', currency: 'EGP', portfolioValue: 10_000, totalReturn: 500 });
    expect(out.allocation.basis).toBe(10_000);
  });

  it('supports ascending, ticker and null-aware sorting', async () => {
    const { deps } = setup();
    const uc = new GetPositions(deps);
    const asc = await uc.execute({ order: 'asc' });
    expect(asc.positions.map((p) => p.ticker.value)).toEqual(['HRHO', 'COMI', 'ZERO']);
    const byTicker = await uc.execute({ sortBy: 'ticker', order: 'asc' });
    expect(byTicker.positions.map((p) => p.ticker.value)).toEqual(['COMI', 'HRHO', 'ZERO']);
  });

  it('keeps two null values in place', async () => {
    const { deps } = setup({
      getAccount: vi.fn(async () => ({
        summary,
        positions: [position('A', null), position('B', null), position('C', 10)],
      })),
    });
    const out = await new GetPositions(deps).execute({ sortBy: 'unrealizedPnl' });
    expect(out.positions.map((p) => p.ticker.value)).toEqual(['C', 'A', 'B']);
  });
});

describe('GetPosition', () => {
  it('resolves the symbol and includes sellable quantity', async () => {
    const { deps, gateway } = setup();
    const out = await new GetPosition(deps).execute({ symbol: 'comi' });
    expect(gateway.getPosition).toHaveBeenCalledWith(AssetId.of(COMI_ID), 'egypt');
    expect(out).toMatchObject({ ticker: 'COMI', held: true, sellable: { custodian: 'THN' } });
  });

  it('skips sellable quantity on request or when not held', async () => {
    const { deps, gateway } = setup();
    const out = await new GetPosition(deps).execute({ symbol: COMI_ID, includeSellable: false });
    expect(out.sellable).toBeNull();
    const none = setup({ getPosition: vi.fn(async () => null) });
    const notHeld = await new GetPosition(none.deps).execute({ symbol: 'HRHO' });
    expect(notHeld).toEqual({ ticker: 'HRHO', held: false, position: null, sellable: null });
    expect(none.gateway.getSellableQuantity).not.toHaveBeenCalled();
    expect(gateway.getSellableQuantity).not.toHaveBeenCalled();
  });
});

describe('ListOrders', () => {
  it('fetches pages without over-fetching and returns the exact next cursor', async () => {
    const listOrders = vi
      .fn()
      .mockResolvedValueOnce({
        orders: Array.from({ length: 20 }, (_, i) => order(`a${i}`)),
        nextCursor: 'c1',
      })
      .mockResolvedValueOnce({
        orders: Array.from({ length: 5 }, (_, i) => order(`b${i}`)),
        nextCursor: 'c2',
      });
    const { deps } = setup({ listOrders });
    const out = await new ListOrders(deps).execute({ status: 'open', limit: 25, symbol: 'COMI' });
    expect(out.orders).toHaveLength(25);
    expect(out.nextCursor).toBe('c2');
    expect(out.status).toBe('open');
    expect(listOrders.mock.calls.map((c) => c[0])).toEqual([
      { market: 'egypt', status: 'open', limit: 20, sortOrder: 'DESC', instrumentId: AssetId.of(COMI_ID) },
      {
        market: 'egypt',
        status: 'open',
        limit: 5,
        sortOrder: 'DESC',
        cursor: 'c1',
        instrumentId: AssetId.of(COMI_ID),
      },
    ]);
  });

  it('stops at the last page, on empty pages, and honours cursor/oldestFirst', async () => {
    const last = setup({ listOrders: vi.fn(async () => ({ orders: [order('1')], nextCursor: null })) });
    const out = await new ListOrders(last.deps).execute({ cursor: 'start', oldestFirst: true, limit: 50 });
    expect(out).toMatchObject({ status: 'all', nextCursor: null });
    expect(out.orders).toHaveLength(1);
    expect(last.gateway.listOrders).toHaveBeenCalledWith({
      market: 'egypt',
      status: 'all',
      limit: 20,
      sortOrder: 'ASC',
      cursor: 'start',
    });
    const empty = setup({ listOrders: vi.fn(async () => ({ orders: [], nextCursor: 'loop' })) });
    const none = await new ListOrders(empty.deps).execute({ limit: 1_000 });
    expect(none.orders).toEqual([]);
    expect(empty.gateway.listOrders).toHaveBeenCalledTimes(1);
  });

  it('clamps the limit and rejects bad filters', async () => {
    const { deps, gateway } = setup();
    await new ListOrders(deps).execute({ limit: 0 });
    expect(vi.mocked(gateway.listOrders).mock.calls[0]?.[0].limit).toBe(1);
    await new ListOrders(deps).execute({ limit: Number.NaN });
    expect(vi.mocked(gateway.listOrders).mock.calls[1]?.[0].limit).toBe(20);
    await expect(new ListOrders(deps).execute({ status: 'nope' })).rejects.toThrow(ValidationError);
  });
});

describe('GetRealizedReturns', () => {
  it('combines current returns with a sorted chart and summary', async () => {
    const { deps, gateway } = setup();
    const out = await new GetRealizedReturns(deps).execute({ interval: '6m' });
    expect(gateway.getReturnsChart).toHaveBeenCalledWith('6M', 'egypt');
    expect(out.current.totalReturns).toBe(300);
    expect(out.series.map((p) => p.totalReturns)).toEqual([100, 300]);
    expect(out.seriesSummary).toMatchObject({ returnsChange: 200, portfolioValueChangePercent: 10 });
    expect(out.interval).toBe('6M');
  });
});

describe('journal use cases', () => {
  it('builds a validated journal query', async () => {
    const { deps, gateway } = setup();
    const from = new Date('2026-01-01T00:00:00Z');
    await new GetClosedTrades(deps).execute({ symbol: 'comi', from, page: 3, limit: 500 });
    expect(gateway.getClosedTrades).toHaveBeenCalledWith({
      market: 'egypt',
      page: 3,
      limit: 100,
      from,
      ticker: 'COMI',
    });
    await new GetSellJournal(deps).execute({ market: 'us' });
    expect(gateway.getSellJournal).toHaveBeenCalledWith({ market: 'us', page: 1, limit: 20 });
    await expect(new GetSellJournal(deps).execute({ from: new Date('2027-01-01') })).rejects.toThrow(
      /future/,
    );
    await expect(new GetClosedTrades(deps).execute({ symbol: '!!' })).rejects.toThrow(ValidationError);
  });

  it('enriches per-instrument metrics with tickers and sorts by return', async () => {
    const overall = createOverallTradingStats({
      totalReturn: 1,
      profitFactor: null,
      expectancyPerTrade: null,
      winRatePercent: null,
      averageWin: null,
      averageLoss: null,
      numberOfTrades: null,
      averagePositionSize: null,
      averageDurationDays: null,
    });
    const getTradingMetrics = vi.fn(async () => ({
      overall,
      perInstrument: [
        stats(COMI_ID, 100),
        stats(UNKNOWN_ID, null),
        stats(HRHO_ID, 300),
        stats(null, 50),
        stats(COMI_ID, 10, Ticker.of('KEEP')),
      ],
    }));
    const { deps } = setup({ getTradingMetrics });
    const from = new Date('2026-01-01T00:00:00Z');
    const out = await new GetTradingMetrics(deps).execute({ from });
    expect(getTradingMetrics).toHaveBeenCalledWith({ from });
    expect(out.overall).toBe(overall);
    expect(out.perInstrument.map((s) => [s.ticker?.value ?? null, s.totalReturn])).toEqual([
      ['HRHO', 300],
      ['COMI', 100],
      [null, 50],
      ['KEEP', 10],
      [null, null],
    ]);
  });
});

describe('ListAccountActivity', () => {
  const activities = [
    createAccountActivity({
      id: '1',
      type: 'BUY_ORDER',
      amount: -10,
      createdAt: null,
      description: null,
      ticker: null,
    }),
    createAccountActivity({
      id: '2',
      type: 'DIVIDEND',
      amount: 5,
      createdAt: null,
      description: null,
      ticker: null,
    }),
  ];

  it('lists a page and filters by category', async () => {
    const listActivities = vi.fn(async () => ({ activities, page: 2, hasMore: true }));
    const { deps } = setup({ listActivities });
    const uc = new ListAccountActivity(deps);
    const all = await uc.execute({ page: 2, pageSize: 5, category: 'all' });
    expect(listActivities).toHaveBeenCalledWith('egypt', 2, 5);
    expect(all.activities).toHaveLength(2);
    expect(all).toMatchObject({ market: 'egypt', page: 2, hasMore: true });
    const dividends = await uc.execute({ category: 'dividend' });
    expect(dividends.activities.map((a) => a.id)).toEqual(['2']);
    expect(listActivities).toHaveBeenLastCalledWith('egypt', 1, 20);
    expect((await uc.execute({ category: '' })).activities).toHaveLength(2);
  });

  it('rejects unknown categories', async () => {
    const { deps } = setup({ listActivities: vi.fn() });
    await expect(new ListAccountActivity(deps).execute({ category: 'bitcoin' })).rejects.toThrow(
      /Unsupported activity category/,
    );
  });
});
