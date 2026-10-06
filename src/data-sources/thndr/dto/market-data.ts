/**
 * Wire formats of Thndr's market-data endpoints (docs/api/market-data.md). Every field is optional and loosely
 * typed on purpose: the API is private and undocumented, so mappers must tolerate missing or re-typed values.
 */

/** Numbers sometimes arrive as decimal strings. */
export type WireNumber = number | string | null;

/** `asset.feed` when `include_feed=true&feed_detail=true` (§1.2). */
export interface AssetFeedDto {
  price?: WireNumber;
  previous_close?: WireNumber;
  last_trade_price?: WireNumber;
  open?: WireNumber;
  last_change_prc?: WireNumber;
  avg_value?: WireNumber;
  /** EGX board: NOPL, OOTC, SME, INDX, FNDS… */
  market_id?: string | null;
  day_tradable?: boolean | null;
  min_price_limit?: WireNumber;
  max_price_limit?: WireNumber;
}

/** A search hit (§1.1) or the asset details payload (§1.2); details is a superset of a search hit. */
export interface AssetDto {
  id?: string | null;
  symbol?: string | null;
  name?: string | null;
  asset_class?: string | null;
  market?: string | null;
  /** 0 points, 1 EGP, 2 USD — or the strings `EGP`/`USD`. */
  currency?: number | string | null;
  is_3dp?: boolean | null;
  round_digits?: WireNumber;
  is_ipo?: boolean | null;
  is_tradable?: boolean | null;
  logo?: string | null;
  industry?: string | null;
  sector?: string | null;
  about?: string | null;
  last_price?: WireNumber;
  symbol_state?: string | null;
  stats?: { symbol_state?: string | null } | null;
  feed?: AssetFeedDto | null;
}

export interface AssetSearchResponseDto {
  assets?: AssetDto[] | null;
}

/** One row of `GET /assets-service/assets/marketwatch` (§1.3). */
export interface MarketwatchAssetDto {
  asset_id?: string | null;
  reuters?: string | null;
  eng_name?: string | null;
  arb_name?: string | null;
  eng_desc?: string | null;
  asset_class?: string | null;
  currency?: number | string | null;
  round_digits?: WireNumber;
  symbol_state?: string | null;
  last_trade_price?: WireNumber;
  close_price?: WireNumber;
  previous_close?: WireNumber;
  open_price?: WireNumber;
  last_change?: WireNumber;
  last_change_prc?: WireNumber;
  high_price?: WireNumber;
  low_price?: WireNumber;
  last_trade_volume?: WireNumber;
  last_trade_date?: string | number | null;
  bid_price?: WireNumber;
  bid_volume?: WireNumber;
  ask_price?: WireNumber;
  ask_volume?: WireNumber;
  listed_shares?: WireNumber;
  pe_ratio?: WireNumber;
  eps?: WireNumber;
  dividend_yield_perc?: WireNumber;
  total_value?: WireNumber;
  total_volume?: WireNumber;
  total_trades?: WireNumber;
  high_price_limit?: WireNumber;
  low_price_limit?: WireNumber;
  max_limit?: WireNumber;
  min_limit?: WireNumber;
  avg_30_day?: WireNumber;
  high_52_week?: WireNumber;
  low_52_week?: WireNumber;
}

export interface MarketwatchResponseDto {
  assets?: MarketwatchAssetDto[] | null;
}

/** Krakend `GET /feed/advanced-charts/v2/{id}/trades` (§2.2). */
export interface CandleDto {
  timestamp?: string | number | null;
  open?: WireNumber;
  high?: WireNumber;
  low?: WireNumber;
  close?: WireNumber;
  volume?: WireNumber;
}

export interface CandlesResponseDto {
  trades_candles?: CandleDto[] | null;
}

/** `GET /assets-service/market-depth/{id}` (§3.1). */
export interface DepthLevelDto {
  order_price?: WireNumber;
  volume_traded?: WireNumber;
  split?: WireNumber;
}

export interface MarketDepthResponseDto {
  bids_per_price?: DepthLevelDto[] | null;
  asks_per_price?: DepthLevelDto[] | null;
  total_bids_and_asks?: { total_bids?: WireNumber; total_asks?: WireNumber } | null;
}

/** `GET /assets-service/market-depth/v3/trades-book/{id}` (§3.2). */
export interface TradeDto {
  cursor?: number | string | null;
  price?: WireNumber;
  volume?: WireNumber;
  side?: string | null;
  time?: string | number | null;
}

export interface TradesBookResponseDto {
  trades?: TradeDto[] | null;
}

/** `GET /market-service/markets/status` (§8.7a). */
export interface MarketStatusDto {
  is_active?: boolean | null;
}

/** `GET /market-service/markets/hours` (§8.7b). */
export interface MarketHoursDto {
  session_open?: string | number | null;
  session_close?: string | number | null;
}

/** `GET /assets-service/assets/market-indicators` (§8.2). */
export interface MarketIndicatorDto {
  id?: string | null;
  symbol?: string | null;
  name?: string | null;
  feed?: {
    price?: WireNumber;
    last_trade_price?: WireNumber;
    last_change_prc?: WireNumber;
    previous_close?: WireNumber;
    market_id?: string | null;
  } | null;
}

export interface MarketIndicatorsResponseDto {
  results?: MarketIndicatorDto[] | null;
}

/** Value of a krakend `error_*` key (§0.2). */
export interface KrakendBackendErrorDto {
  http_status_code?: number;
  http_body?: string;
}
