/**
 * Wire formats of Thndr's account/portfolio/orders/journal/activity endpoints (docs/api/trading-and-portfolio.md).
 * Every field is optional and loosely typed: the API is private, mappers must tolerate missing or re-typed values.
 * Order-entry payloads are intentionally absent (ADR 0006).
 */
import type { WireNumber } from './market-data.js';

/** §1.1 / §1.2 position. */
export interface PositionDto {
  asset_id?: string | null;
  symbol?: string | null;
  logo?: string | null;
  asset_class?: string | null;
  currency?: string | number | null;
  unit?: string | null;
  qty?: WireNumber;
  cost_value?: WireNumber;
  avg_cost?: WireNumber;
  market_price?: WireNumber;
  gain_loss?: WireNumber;
  gain_loss_percentage?: WireNumber;
}

/** §1.1 `GET /market-service/accounts/wallet-and-portfolio`. */
export interface WalletAndPortfolioDto {
  purchase_power?: WireNumber;
  cash_in_holding?: WireNumber;
  unsettled_cash?: WireNumber;
  settled_cash?: WireNumber;
  portfolio?: {
    portfolio_value?: WireNumber;
    total_return?: WireNumber;
    total_return_prc?: WireNumber;
    positions?: PositionDto[] | null;
  } | null;
}

export interface CustodianQtyDto {
  custodian?: string | null;
  qty?: WireNumber;
  qty_blocked?: WireNumber;
}

/** §1.3 `GET /market-service/accounts/positions/blocked-quantities/{asset_id}`. */
export interface BlockedQuantitiesDto {
  qty?: WireNumber;
  qty_blocked?: WireNumber;
  qty_t0?: WireNumber;
  qty_blocked_t0?: WireNumber;
  qty_t1?: WireNumber;
  qty_blocked_t1?: WireNumber;
  qty_settled?: WireNumber;
  qty_blocked_settled?: WireNumber;
  unsalable_qty?: WireNumber;
  qty_blocked_unsalable?: WireNumber;
  qty_settled_per_custodian?: CustodianQtyDto[] | null;
}

/** §1.4 `GET /market-service/realized-returns`. */
export interface RealizedReturnsDto {
  total_returns?: WireNumber;
  snapshot_date?: string | number | null;
}

/** §1.5 one point of `GET /market-service/realized-returns/chart/{interval}`. */
export interface ReturnsPointDto {
  snapshot_date?: string | number | null;
  total_returns?: WireNumber;
  portfolio_value?: WireNumber;
}

export interface BracketLegDto {
  id?: string | number | null;
  qty?: WireNumber;
  trigger_price?: WireNumber;
  limit_price?: WireNumber;
  type?: string | null;
  status?: string | null;
}

export interface OrderPairDto {
  pair_id?: string | null;
  take_profit?: BracketLegDto | null;
  stop_loss?: BracketLegDto | null;
}

/** §3.1 one order of `GET /market-service/v3/orders`. */
export interface OrderDto {
  id?: string | number | null;
  asset_id?: string | null;
  stock_id?: string | null;
  reuters_code?: string | null;
  asset_class?: string | null;
  /** The side (BUY/SELL), despite its name. */
  order_type?: string | null;
  is_limit?: boolean | null;
  order_class?: string | null;
  amount?: WireNumber;
  amount_filled?: WireNumber;
  price?: WireNumber;
  limit_price?: WireNumber;
  order_status?: string | null;
  order_status_details?: string | null;
  time_in_force?: string | null;
  time_in_force_date?: string | number | null;
  execution_type?: string | null;
  settlement?: string | null;
  order_pairs?: OrderPairDto[] | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

export interface OrdersPageDto {
  data?: OrderDto[] | null;
  has_next?: boolean | null;
  cursor?: string | number | null;
}

/** §4.1 `GET /market-service/trading-journals/full-trades`. */
export interface FullTradeDto {
  asset_id?: string | null;
  reuters_code?: string | null;
  open_date?: string | number | null;
  close_date?: string | number | null;
  avg_entry_price?: WireNumber;
  close_price?: WireNumber;
  volume?: WireNumber;
  net_pnl?: WireNumber;
  net_pnl_percentage?: WireNumber;
  duration_days?: WireNumber;
}

export interface FullTradesResponseDto {
  full_trades?: FullTradeDto[] | null;
  total_count?: WireNumber;
}

/** §4.2 krakend `GET /trading-journals/v1/grouped-sells`. */
export interface SellJournalDto {
  asset_id?: string | null;
  reuters_code?: string | null;
  symbol_code?: string | null;
  exit_date?: string | number | null;
  exit_price?: WireNumber;
  exit_value?: WireNumber;
  volume_sold?: WireNumber;
  avg_entry_price?: WireNumber;
  net_pnl?: WireNumber;
  pnl_percentage?: WireNumber;
}

export interface GroupedSellsResponseDto {
  sell_journals?: SellJournalDto[] | null;
  total_count?: WireNumber;
}

export interface SymbolStatsDto {
  total_return_egp?: WireNumber;
  total_pnl_percentage?: WireNumber;
  win_rate_percentage?: WireNumber;
  number_of_trades?: WireNumber;
  average_win_egp?: WireNumber;
  average_loss_egp?: WireNumber;
  average_position_size_egp?: WireNumber;
}

/** §4.3 krakend `GET /trading-journals/v1/trading-metrics`. */
export interface TradingMetricsDto {
  overall_stats?: {
    total_return_egp?: WireNumber;
    profit_factor?: WireNumber;
    expectancy_per_trade_egp?: WireNumber;
    win_rate_percentage?: WireNumber;
    average_win_egp?: WireNumber;
    average_loss_egp?: WireNumber;
    number_of_trades?: WireNumber;
    average_position_size_egp?: WireNumber;
    average_duration_days?: WireNumber;
  } | null;
  stats_per_symbol?: Record<string, SymbolStatsDto | null> | null;
}

/** §5.1 `GET /funding-service/account-activities`. */
export interface AccountActivityDto {
  ordering_id?: string | number | null;
  activity_type?: string | null;
  amount?: WireNumber;
  created_at?: string | number | null;
  description?: string | null;
  asset_meta?: { symbol?: string | null } | null;
}

export interface AccountActivitiesResponseDto {
  results?: AccountActivityDto[] | null;
  count?: WireNumber;
}
