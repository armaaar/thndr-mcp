import { UpstreamError } from '../../../application/errors';
import type {
  AccountActivityDto,
  BlockedQuantitiesDto,
  BracketLegDto,
  FullTradeDto,
  OrderDto,
  PositionDto,
  RealizedReturnsDto,
  ReturnsPointDto,
  SellJournalDto,
  SymbolStatsDto,
  TradingMetricsDto,
  WalletAndPortfolioDto,
} from '../../../data-sources/thndr/dto/portfolio';
import { parseTimestamp, toNumber, toStringOrNull } from '../../../data-sources/thndr/wire';
import { accountCurrency, createAccountSummary } from '../../../domain/portfolio/account-summary';
import { type AccountActivity, createAccountActivity } from '../../../domain/portfolio/activity';
import {
  type ClosedTrade,
  createOverallTradingStats,
  type InstrumentTradingStats,
  type SellJournalEntry,
  type TradingMetrics,
} from '../../../domain/portfolio/journal';
import { type BracketLeg, createOrder, type Order, type OrderType } from '../../../domain/portfolio/order';
import { createPosition, type Position } from '../../../domain/portfolio/position';
import type { AccountSnapshot } from '../../../domain/portfolio/repository';
import type { RealizedReturns, ReturnsPoint } from '../../../domain/portfolio/returns';
import {
  CUSTODIANS,
  type Custodian,
  quantityBucket,
  type SellableQuantity,
} from '../../../domain/portfolio/sellable-quantity';
import { DomainError } from '../../../domain/shared-kernel/errors';
import { type Market, parseAssetClass } from '../../../domain/shared-kernel/market';
import { mapCurrency, mapRows, parseAssetIdOrNull, sanitizeTicker } from './market-data';

function isObject<T>(value: T | null | undefined): value is T & object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** Runs a domain factory, turning validation failures of a malformed row into "skip this row". */
function tolerant<T>(build: () => T): T | null {
  try {
    return build();
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/** Maps one position (§1.1 / §1.2). Rows without a usable ticker or quantity yield null. */
export function toPosition(dto: PositionDto | null | undefined, market: Market): Position | null {
  if (!isObject(dto)) return null;
  const ticker = sanitizeTicker(dto.symbol);
  const quantity = toNumber(dto.qty);
  if (!ticker || quantity === null) return null;
  return tolerant(() =>
    createPosition({
      instrumentId: parseAssetIdOrNull(dto.asset_id),
      ticker,
      assetClass: parseAssetClass(dto.asset_class),
      currency: mapCurrency(dto.currency) ?? accountCurrency(market),
      quantity,
      averageCost: toNumber(dto.avg_cost),
      costValue: toNumber(dto.cost_value),
      marketPrice: toNumber(dto.market_price),
      unrealizedPnl: toNumber(dto.gain_loss),
      unrealizedPnlPercent: toNumber(dto.gain_loss_percentage),
      unit: stringOrNull(dto.unit),
    }),
  );
}

/** Maps the wallet-and-portfolio payload (§1.1). `purchase_power` is mandatory; other cash fields default to 0. */
export function toAccountSnapshot(
  dto: WalletAndPortfolioDto | null | undefined,
  market: Market,
): AccountSnapshot {
  const buyingPower = isObject(dto) ? toNumber(dto.purchase_power) : null;
  if (!isObject(dto) || buyingPower === null) {
    throw new UpstreamError('Unexpected wallet-and-portfolio payload from Thndr: missing purchase_power');
  }
  const positions = mapRows(dto.portfolio?.positions, (row) => toPosition(row, market));
  const portfolioValue =
    toNumber(dto.portfolio?.portfolio_value) ?? positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  const summary = createAccountSummary({
    buyingPower,
    blockedCash: toNumber(dto.cash_in_holding) ?? 0,
    unsettledCash: toNumber(dto.unsettled_cash) ?? 0,
    settledCash: toNumber(dto.settled_cash),
    portfolioValue,
    totalReturn: toNumber(dto.portfolio?.total_return),
    totalReturnPercent: toNumber(dto.portfolio?.total_return_prc),
    currency: accountCurrency(market),
  });
  return Object.freeze({ summary, positions: Object.freeze(positions) });
}

function toCustodian(raw: unknown): Custodian | null {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return (CUSTODIANS as readonly string[]).includes(value) ? (value as Custodian) : null;
}

/** Maps blocked quantities (§1.3). Custodian rule from ThndrX: AUB if settled shares sit at AUB, else THN. */
export function toSellableQuantity(dto: BlockedQuantitiesDto | null | undefined): SellableQuantity {
  const d: BlockedQuantitiesDto = isObject(dto) ? dto : {};
  const settledCustodians = Array.isArray(d.qty_settled_per_custodian)
    ? d.qty_settled_per_custodian.map((c) => toCustodian(c?.custodian))
    : null;
  const custodian =
    settledCustodians === null ? null : settledCustodians.includes('AUB') ? 'AUB' : ('THN' as const);
  return Object.freeze({
    all: quantityBucket(toNumber(d.qty), toNumber(d.qty_blocked)),
    t0: quantityBucket(toNumber(d.qty_t0), toNumber(d.qty_blocked_t0)),
    t1: quantityBucket(toNumber(d.qty_t1), toNumber(d.qty_blocked_t1)),
    settled: quantityBucket(toNumber(d.qty_settled), toNumber(d.qty_blocked_settled)),
    unsalable: quantityBucket(toNumber(d.unsalable_qty), toNumber(d.qty_blocked_unsalable)),
    custodian,
  });
}

export function toRealizedReturns(dto: RealizedReturnsDto | null | undefined): RealizedReturns {
  return Object.freeze({
    totalReturns: isObject(dto) ? toNumber(dto.total_returns) : null,
    snapshotDate: isObject(dto) ? parseTimestamp(dto.snapshot_date) : null,
  });
}

export function toReturnsPoint(dto: ReturnsPointDto | null | undefined): ReturnsPoint | null {
  if (!isObject(dto)) return null;
  const date = parseTimestamp(dto.snapshot_date);
  if (!date) return null;
  return Object.freeze({
    date,
    totalReturns: toNumber(dto.total_returns),
    portfolioValue: toNumber(dto.portfolio_value),
    netDeposits: toNumber(dto.net_deposits),
  });
}

function toLegType(raw: unknown): OrderType | null {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return value === 'LIMIT' || value === 'MARKET' ? value : null;
}

function toBracketLeg(dto: BracketLegDto | null | undefined, kind: BracketLeg['kind']): BracketLeg | null {
  if (!isObject(dto)) return null;
  return Object.freeze({
    kind,
    id: toStringOrNull(dto.id),
    quantity: toNumber(dto.qty),
    triggerPrice: toNumber(dto.trigger_price),
    limitPrice: toNumber(dto.limit_price),
    type: toLegType(dto.type),
    status: stringOrNull(dto.status),
  });
}

function toBracketLegs(dto: OrderDto): BracketLeg[] {
  const legs: BracketLeg[] = [];
  for (const pair of Array.isArray(dto.order_pairs) ? dto.order_pairs : []) {
    if (!isObject(pair)) continue;
    const takeProfit = toBracketLeg(pair.take_profit, 'TAKE_PROFIT');
    const stopLoss = toBracketLeg(pair.stop_loss, 'STOP_LOSS');
    if (takeProfit) legs.push(takeProfit);
    if (stopLoss) legs.push(stopLoss);
  }
  return legs;
}

/**
 * Maps one order (§3.1). The side is the wire `order_type`; `is_limit` gives the variant (EGX orders default to
 * LIMIT when the flag is missing). Rows without id, ticker, side or quantity yield null.
 */
export function toOrder(dto: OrderDto | null | undefined): Order | null {
  if (!isObject(dto)) return null;
  const id = toStringOrNull(dto.id);
  const ticker = sanitizeTicker(dto.stock_id) ?? sanitizeTicker(dto.reuters_code);
  const side = typeof dto.order_type === 'string' ? dto.order_type.toUpperCase() : '';
  const quantity = toNumber(dto.amount);
  if (!id || !ticker || (side !== 'BUY' && side !== 'SELL') || quantity === null) return null;
  return tolerant(() =>
    createOrder({
      id,
      instrumentId: parseAssetIdOrNull(dto.asset_id),
      ticker,
      side,
      type: dto.is_limit === false ? 'MARKET' : 'LIMIT',
      quantity,
      filledQuantity: toNumber(dto.amount_filled),
      price: toNumber(dto.price),
      limitPrice: toNumber(dto.limit_price),
      status: stringOrNull(dto.order_status) ?? 'UNKNOWN',
      statusDetail: stringOrNull(dto.order_status_details),
      timeInForce: stringOrNull(dto.time_in_force)?.toUpperCase() ?? null,
      expiresAt: parseTimestamp(dto.time_in_force_date),
      executionType: stringOrNull(dto.execution_type),
      settlement: stringOrNull(dto.settlement),
      orderClass: stringOrNull(dto.order_class),
      brackets: toBracketLegs(dto),
      createdAt: parseTimestamp(dto.created_at),
      updatedAt: parseTimestamp(dto.updated_at),
    }),
  );
}

/** §4.1 full trade. */
export function toClosedTrade(dto: FullTradeDto | null | undefined): ClosedTrade | null {
  if (!isObject(dto)) return null;
  const ticker = sanitizeTicker(dto.reuters_code);
  if (!ticker) return null;
  return Object.freeze({
    instrumentId: parseAssetIdOrNull(dto.asset_id),
    ticker,
    openedAt: parseTimestamp(dto.open_date),
    closedAt: parseTimestamp(dto.close_date),
    averageEntryPrice: toNumber(dto.avg_entry_price),
    averageExitPrice: toNumber(dto.close_price),
    quantity: toNumber(dto.volume),
    netPnl: toNumber(dto.net_pnl),
    netPnlPercent: toNumber(dto.net_pnl_percentage),
    durationDays: toNumber(dto.duration_days),
  });
}

/** §4.2 grouped sell. */
export function toSellJournalEntry(dto: SellJournalDto | null | undefined): SellJournalEntry | null {
  if (!isObject(dto)) return null;
  const ticker = sanitizeTicker(dto.reuters_code) ?? sanitizeTicker(dto.symbol_code);
  if (!ticker) return null;
  return Object.freeze({
    instrumentId: parseAssetIdOrNull(dto.asset_id),
    ticker,
    exitedAt: parseTimestamp(dto.exit_date),
    exitPrice: toNumber(dto.exit_price),
    exitValue: toNumber(dto.exit_value),
    quantitySold: toNumber(dto.volume_sold),
    averageEntryPrice: toNumber(dto.avg_entry_price),
    netPnl: toNumber(dto.net_pnl),
    netPnlPercent: toNumber(dto.pnl_percentage),
  });
}

function toInstrumentStats(assetId: string, dto: SymbolStatsDto | null | undefined): InstrumentTradingStats {
  const d: SymbolStatsDto = isObject(dto) ? dto : {};
  return Object.freeze({
    instrumentId: parseAssetIdOrNull(assetId),
    ticker: null,
    totalReturn: toNumber(d.total_return_egp),
    totalPnlPercent: toNumber(d.total_pnl_percentage),
    winRatePercent: toNumber(d.win_rate_percentage),
    numberOfTrades: toNumber(d.number_of_trades),
    averageWin: toNumber(d.average_win_egp),
    averageLoss: toNumber(d.average_loss_egp),
    averagePositionSize: toNumber(d.average_position_size_egp),
  });
}

/** §4.3 trading metrics. */
export function toTradingMetrics(dto: TradingMetricsDto | null | undefined): TradingMetrics {
  const stats = isObject(dto) && isObject(dto.overall_stats) ? dto.overall_stats : {};
  const perSymbol = isObject(dto) && isObject(dto.stats_per_symbol) ? dto.stats_per_symbol : {};
  return Object.freeze({
    overall: createOverallTradingStats({
      totalReturn: toNumber(stats.total_return_egp),
      profitFactor: toNumber(stats.profit_factor),
      expectancyPerTrade: toNumber(stats.expectancy_per_trade_egp),
      winRatePercent: toNumber(stats.win_rate_percentage),
      averageWin: toNumber(stats.average_win_egp),
      averageLoss: toNumber(stats.average_loss_egp),
      numberOfTrades: toNumber(stats.number_of_trades),
      averagePositionSize: toNumber(stats.average_position_size_egp),
      averageDurationDays: toNumber(stats.average_duration_days),
    }),
    perInstrument: Object.freeze(
      Object.entries(perSymbol).map(([assetId, row]) => toInstrumentStats(assetId, row)),
    ),
  });
}

/** §5.1 account activity. Amounts may arrive as formatted strings (`"-1,234.50"`). */
export function toAccountActivity(dto: AccountActivityDto | null | undefined): AccountActivity | null {
  if (!isObject(dto)) return null;
  return createAccountActivity({
    id: toStringOrNull(dto.ordering_id) ?? '',
    type: stringOrNull(dto.activity_type) ?? 'OTHER',
    amount: toNumber(dto.amount),
    createdAt: parseTimestamp(dto.created_at),
    description: stringOrNull(dto.description),
    ticker: sanitizeTicker(dto.asset_meta?.symbol),
  });
}
