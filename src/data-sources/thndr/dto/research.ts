/**
 * Wire formats of Thndr's research endpoints (docs/api/market-data.md §8): financials and macros on
 * `x.thndr.app/api`, news on `prod.thndr.app/api/post/news/`, the yearly return on the asset details. Loosely typed on
 * purpose: mappers must tolerate missing or re-typed values.
 */
import type { WireNumber } from './market-data';

/** One `{period, value}` point of a financials metric ("Q2 26", "TTM Q2 26", "2025"). */
export interface FinancialPointDto {
  period?: string | null;
  value?: WireNumber;
}

/** `GET /financials?symbol=X&mode=…` → `{currency, <metric>: FinancialPointDto[] …}`. */
export interface FinancialsDto {
  currency?: string | null;
  [metric: string]: FinancialPointDto[] | string | null | undefined;
}

/** `GET /financials?symbols=A,B&mode=…` → `{A: FinancialsDto, B: FinancialsDto}`. */
export type FinancialsBatchDto = Record<string, FinancialsDto | null | undefined>;

export interface NewsStockDto {
  symbol?: string | null;
  id?: number | null;
  asset_id?: string | null;
  asset_class?: string | null;
}

export interface NewsItemDto {
  id?: number | string | null;
  stocks?: NewsStockDto[] | null;
  title?: string | null;
  content?: string | null;
  created_at?: string | null;
  locale?: string | null;
  market?: string | null;
  link?: string | null;
  external_id?: string | null;
  source?: string | null;
  source_logo?: string | null;
  image?: string | null;
}

/** `GET /api/post/news/?asset_id=&locale=&page=` (Django REST pagination, 25 per page). */
export interface NewsResponseDto {
  count?: number | null;
  next?: string | null;
  previous?: string | null;
  results?: NewsItemDto[] | null;
}

/** `macros.overview.<name>`: `{value, date | period, growth}`; `gdp` is a flat record of numbers. */
export interface MacroReadingDto {
  value?: WireNumber;
  date?: string | null;
  period?: string | null;
  growth?: WireNumber;
  [field: string]: unknown;
}

export interface InflationPointDto {
  date?: string | null;
  headline?: WireNumber;
  core?: WireNumber;
  goods_and_services?: WireNumber;
  fruits_and_vegetables?: WireNumber;
}

export interface OvernightRatesPointDto {
  date?: string | null;
  deposits_rate?: WireNumber;
  lending_rate?: WireNumber;
}

export interface TreasuryBillsPointDto {
  date?: string | null;
  '1m_return'?: WireNumber;
  '3m_return'?: WireNumber;
  '6m_return'?: WireNumber;
  '9m_return'?: WireNumber;
  '12m_return'?: WireNumber;
}

export interface UnemploymentPointDto {
  year?: WireNumber;
  quarter?: WireNumber;
  rate?: WireNumber;
}

/** `GET x.thndr.app/api/macros`. */
export interface MacrosDto {
  metadata?: {
    description?: string | null;
    extracted_at?: string | null;
    sources?: Record<string, unknown> | null;
  } | null;
  overview?: Record<string, MacroReadingDto | null> | null;
  overnight_rates?: OvernightRatesPointDto[] | null;
  unemployment?: UnemploymentPointDto[] | null;
  inflation_monthly?: InflationPointDto[] | null;
  inflation_yearly?: InflationPointDto[] | null;
  treasury_bills?: TreasuryBillsPointDto[] | null;
}

/** The part of the asset details read for the yearly return (`include_yearly_return=true`). */
export interface AssetYearlyReturnDto {
  annual_return?: { value?: WireNumber; return?: string | null } | null;
}
