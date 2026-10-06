import { ValidationError } from '../shared-kernel/errors';

/**
 * Reporting basis of a financial statement series (Thndr `/financials` `mode`):
 * - `qoq` — each quarter on its own ("Q2 26");
 * - `yoy` — fiscal years ("2025");
 * - `ttm` — trailing twelve months at each quarter end ("TTM Q2 26"): a full year of flows that is comparable across
 *   companies and seasons, so it is our default.
 */
export const FINANCIAL_MODES = ['ttm', 'qoq', 'yoy'] as const;
export type FinancialMode = (typeof FINANCIAL_MODES)[number];

/** One reported value of a metric. `null` when Thndr lists the period without a value. */
export interface FinancialPoint {
  readonly period: string;
  readonly value: number | null;
}

/** The financial statement metrics of one company, as Thndr reports them (ThndrX "Company financials"). */
export interface FinancialStatements {
  readonly currency: string | null;
  readonly mode: FinancialMode;
  /** Metric key (Thndr's, e.g. `revenues`, `roe_%`) → points in Thndr's order (oldest first). */
  readonly series: Readonly<Record<string, readonly FinancialPoint[]>>;
}

export function createFinancialStatements(input: FinancialStatements): FinancialStatements {
  if (!FINANCIAL_MODES.includes(input.mode))
    throw new ValidationError(`Unknown financials mode "${input.mode}"`);
  const series: Record<string, readonly FinancialPoint[]> = {};
  for (const [key, points] of Object.entries(input.series)) {
    series[key] = Object.freeze(points.map((p) => Object.freeze({ period: p.period, value: p.value })));
  }
  return Object.freeze({ currency: input.currency, mode: input.mode, series: Object.freeze(series) });
}

/**
 * The metric keys ThndrX's financials screens read, by statement (bundle module 460 and its metric builders). Thndr
 * returns only the keys that apply to a company (banks have loans and deposits but no gross profit, …) and may return
 * a few others (e.g. `nos`, the number of shares).
 */
export const FINANCIAL_METRIC_GROUPS = {
  balanceSheet: [
    'total_assets',
    'total_liabilities',
    'total_equity',
    'minority_interest_bs',
    'total_debt',
    'total_cash_and_cash_equivalents',
    'st_investments',
    'lt_investments',
    'inventory',
    'customer_deposits',
    'loans',
  ],
  incomeStatement: [
    'revenues',
    'gross_profit',
    'operating_profit',
    'ebitda',
    'ebit',
    'net_income',
    'eps',
    'net_interest_income',
    'total_non_interest_income',
    'credit_loss_provisions',
  ],
  cashFlow: ['cfo', 'fcff', 'fcfe', 'capex'],
  profitability: [
    'roe_%',
    'roa_%',
    'roae_%',
    'roaa_%',
    'roic_%',
    'gross_margin_%',
    'operating_margin_%',
    'net_margin_%',
    'ebitda_margin_%',
  ],
  leverage: ['net_debt_total_capital', 'net_debt_total_equity', 'net_debt_ebitda', 'interest_coverage_ratio'],
  efficiency: ['assets_turnover', 'inventory_turnover', 'receivables_turnover'],
  liquidity: ['current_ratio', 'quick_ratio', 'cash_ratio'],
  growth: [
    'revenue_growth_1y',
    'eps_growth_%',
    'avg_revenue_growth_3y',
    'avg_eps_growth_3y',
    'assets_growth_1y',
    'equity_growth_1y',
    'net_income_growth_1y',
    'ebitda_growth_1y',
    'revenue_cagr',
    'net_income_cagr',
    'ebitda_cagr',
  ],
  valuation: [
    'market_cap',
    'pe_ratio',
    'pb_ratio',
    'ps_ratio',
    'peg_ratio',
    'ev',
    'ev_ebitda',
    'ev_ebit',
    'ev_revenues',
    'dividend_yield',
    'par_value',
    'book_value',
    'bvps',
  ],
} as const satisfies Record<string, readonly string[]>;

/** A compact core set shown when no metrics are requested (keys a company lacks are simply absent). */
export const DEFAULT_FINANCIAL_METRICS: readonly string[] = Object.freeze([
  'revenues',
  'gross_profit',
  'operating_profit',
  'ebitda',
  'net_income',
  'eps',
  'net_interest_income',
  'total_assets',
  'total_liabilities',
  'total_equity',
  'total_debt',
  'customer_deposits',
  'loans',
  'cfo',
  'fcff',
  'gross_margin_%',
  'operating_margin_%',
  'net_margin_%',
  'roe_%',
  'roa_%',
  'revenue_growth_1y',
  'eps_growth_%',
  'bvps',
]);

const YEAR = /^\d{4}$/;
const QUARTER = /^(TTM\s+)?Q([1-4])\s+(\d{2}|\d{4})$/;

interface PeriodKey {
  year: number;
  order: number;
  ttm: boolean;
}

/** Parses Thndr period labels: "2025", "Q2 26", "TTM Q2 26" (ThndrX module 13280). */
function parsePeriod(label: string): PeriodKey | null {
  const text = label.trim().toUpperCase();
  if (YEAR.test(text)) return { year: Number.parseInt(text, 10), order: 5, ttm: false };
  const match = QUARTER.exec(text);
  if (!match) return null;
  const [, ttm, quarter = '', year = ''] = match;
  const y = Number.parseInt(year, 10);
  return { year: year.length === 2 ? 2000 + y : y, order: Number.parseInt(quarter, 10), ttm: Boolean(ttm) };
}

/** Chronological order of period labels; unknown labels sort alphabetically. */
export function comparePeriods(a: string, b: string): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.year - pb.year || pa.order - pb.order || Number(pa.ttm) - Number(pb.ttm);
}

/** The most recent period any metric reports. */
export function latestPeriod(statements: FinancialStatements): string | null {
  const periods = new Set<string>();
  for (const points of Object.values(statements.series)) for (const p of points) periods.add(p.period);
  return [...periods].sort(comparePeriods).at(-1) ?? null;
}

/** The last reported value of a metric, as ThndrX reads it (the series' last element). */
export function latestValue(statements: FinancialStatements, key: string): number | null {
  return statements.series[key]?.at(-1)?.value ?? null;
}

/** The value of a metric for one period. */
export function valueAt(statements: FinancialStatements, key: string, period: string): number | null {
  return statements.series[key]?.find((p) => p.period === period)?.value ?? null;
}

/** `a / b`, or null when either is missing or `b` is zero (ThndrX's safe division). */
export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  return a === null || a === undefined || b === null || b === undefined || b === 0 ? null : a / b;
}

/** What the market says about a company today (from the marketwatch snapshot). */
export interface MarketFigures {
  readonly price: number | null;
  readonly listedShares: number | null;
  readonly dividendYieldPercent: number | null;
}

export interface Valuation {
  price: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  pegRatio: number | null;
  evEbitda: number | null;
  evEbit: number | null;
  evRevenues: number | null;
}

/**
 * Valuation ratios at today's price against the latest reported period, as ThndrX computes them (module 36255):
 * market cap = listed shares × price; EV = market cap + total debt − cash − short-term investments; P/E is
 * dropped when EPS is negative; P/B uses equity net of minority interest, else price / BVPS. In `qoq` mode the
 * denominators are a single quarter's figures, so prefer `ttm` for ratios.
 */
export function valuation(statements: FinancialStatements, market: MarketFigures): Valuation {
  const price = market.price;
  const period = latestPeriod(statements);
  if (period === null) {
    return {
      price,
      marketCap: null,
      enterpriseValue: null,
      peRatio: null,
      pbRatio: null,
      psRatio: null,
      pegRatio: null,
      evEbitda: null,
      evEbit: null,
      evRevenues: null,
    };
  }
  const at = (key: string) => valueAt(statements, key, period);
  const marketCap = market.listedShares && price ? market.listedShares * price : null;
  const enterpriseValue =
    marketCap === null
      ? null
      : marketCap +
        (at('total_debt') ?? 0) -
        (at('total_cash_and_cash_equivalents') ?? 0) -
        (at('st_investments') ?? 0);
  const equity = at('total_equity');
  const pe = ratio(price, at('eps'));
  const peRatio = pe !== null && pe < 0 ? null : pe;
  return {
    price,
    marketCap,
    enterpriseValue,
    peRatio,
    pbRatio:
      ratio(marketCap, equity === null ? null : equity - (at('minority_interest_bs') ?? 0)) ??
      ratio(price, at('bvps')),
    psRatio: ratio(marketCap, at('revenues')),
    pegRatio: ratio(peRatio, at('eps_growth_%')),
    evEbitda: ratio(enterpriseValue, at('ebitda')),
    evEbit: ratio(enterpriseValue, at('ebit')),
    evRevenues: ratio(enterpriseValue, at('revenues')),
  };
}
