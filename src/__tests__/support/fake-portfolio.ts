import { vi } from 'vitest';
import { NotFoundError } from '../../application/errors';
import { IndexMembership } from '../../application/market-data/services/index-membership';
import { InstrumentResolver } from '../../application/market-data/services/instrument-resolver';
import { MarketQuotesCache } from '../../application/market-data/services/market-quotes-cache';
import type { PortfolioDependencies } from '../../application/portfolio/dependencies';
import type { Instrument } from '../../domain/market-data/instrument';
import type { MarketDataRepository } from '../../domain/market-data/repository';
import { createAccountSummary } from '../../domain/portfolio/account-summary';
import type { InstrumentTradingStats } from '../../domain/portfolio/journal';
import { createOrder, type Order } from '../../domain/portfolio/order';
import { createPosition, type Position } from '../../domain/portfolio/position';
import type { PortfolioRepository } from '../../domain/portfolio/repository';
import { quantityBucket } from '../../domain/portfolio/sellable-quantity';
import { AssetId } from '../../domain/shared-kernel/asset-id';
import { Ticker } from '../../domain/shared-kernel/ticker';

export const NOW = new Date('2026-06-01T12:00:00Z');
export const COMI_ID = '11111111-2222-3333-4444-555555555555';
export const HRHO_ID = '66666666-7777-8888-9999-000000000000';
export const UNKNOWN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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

function marketData(): MarketDataRepository {
  return {
    searchInstruments: vi.fn(async (query: string) => instruments.filter((i) => i.ticker.value === query)),
    getInstrument: vi.fn(async (id: AssetId) => {
      const found = instruments.find((i) => i.id.equals(id));
      if (!found) throw new NotFoundError('no such asset');
      return found;
    }),
    getMarketQuotes: vi.fn(async () => []),
    getCandles: vi.fn(),
    getOrderBook: vi.fn(),
    getRecentTrades: vi.fn(),
    getMarketSession: vi.fn(),
    getMarketIndicators: vi.fn(),
    getIndexConstituents: vi.fn(async () => []),
    getSimilarInstruments: vi.fn(),
    getScreeners: vi.fn(),
    getScreener: vi.fn(),
  } as unknown as MarketDataRepository;
}

export function position(
  ticker: string,
  marketPrice: number | null,
  overrides: Partial<Position> = {},
): Position {
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

export const summary = createAccountSummary({
  buyingPower: 1_000,
  blockedCash: 0,
  unsettledCash: 200,
  settledCash: null,
  portfolioValue: 10_000,
  totalReturn: 500,
  totalReturnPercent: 5,
  currency: 'EGP',
});

export function order(id: string): Order {
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

export function stats(
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

/**
 * A fake portfolio repository (vi.fn per method) plus the real Market Data services (resolver, quotes cache, index
 * membership) over a fake market-data repo (`md`: no quotes and no index members unless a test mocks them).
 */
export function setupPortfolio(overrides: Partial<PortfolioRepository> = {}) {
  const repository: PortfolioRepository = {
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
    getSavings: vi.fn(async () => ({
      totalAmount: 0,
      totalGain: 0,
      count: 0,
      amountsPerType: {},
      clouds: [],
    })),
    getSavingsYields: vi.fn(async () => []),
    ...overrides,
  };
  const md = marketData();
  const clock = { now: () => NOW };
  const quotes = new MarketQuotesCache(md, clock);
  const deps: PortfolioDependencies = {
    repository,
    resolver: new InstrumentResolver(md),
    quotes,
    indices: new IndexMembership(md, quotes, clock),
    clock,
  };
  return { repository, deps, md };
}
