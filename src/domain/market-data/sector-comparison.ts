import {
  type FinancialMode,
  type FinancialStatements,
  latestValue,
  type MarketFigures,
  ratio,
  valuation,
} from './financials';

/** ThndrX's "metrics details" categories, each with an overall rating. */
export const COMPARISON_CATEGORIES = [
  'financialHealth',
  'efficiency',
  'growth',
  'profitability',
  'valuation',
] as const;
export type ComparisonCategory = (typeof COMPARISON_CATEGORIES)[number];

export interface ComparisonMetric {
  readonly key: string;
  readonly category: ComparisonCategory;
  /** A lower value ranks better (valuation multiples, leverage). */
  readonly lowerIsBetter: boolean;
  /** Counts towards the category rating (ThndrX `includeInRating`). */
  readonly rated: boolean;
  /** ThndrX hides it for quarterly (`qoq`) data. */
  readonly hiddenInQoq?: boolean;
  /** Unit of the value (`%` = percent points, `x` = multiple/ratio). */
  readonly unit: '%' | 'x';
  /** The Thndr metric key it is read from, or how it is derived (Thndr serves no valuation multiples). */
  readonly source: string;
  /** Depends on the share price (market cap), so the company's own value uses its valuation price. */
  readonly priceBased?: boolean;
}

interface MetricOptions {
  rated?: boolean;
  hiddenInQoq?: boolean;
  priceBased?: boolean;
}

const m = (
  key: string,
  category: ComparisonCategory,
  lowerIsBetter: boolean,
  unit: '%' | 'x',
  source: string,
  { rated = true, hiddenInQoq = false, priceBased = false }: MetricOptions = {},
): ComparisonMetric =>
  Object.freeze({
    key,
    category,
    lowerIsBetter,
    rated,
    unit,
    source,
    ...(hiddenInQoq ? { hiddenInQoq } : {}),
    ...(priceBased ? { priceBased } : {}),
  });

const MARKET_CAP = 'market cap (listed shares × price)';
const EV = `EV (${MARKET_CAP} + total_debt − total_cash_and_cash_equivalents − st_investments)`;

/**
 * The metrics ThndrX compares with the sector, in its display order (bundle chunk 334 metric builders; lower-is-better
 * map `en` and the `includeInRating` flags in chunk 6076).
 */
export const COMPARISON_METRICS: readonly ComparisonMetric[] = Object.freeze([
  m('netDebtTotalEquity', 'financialHealth', true, 'x', 'net_debt_total_equity'),
  m('netDebtEbitda', 'financialHealth', true, 'x', 'net_debt_ebitda'),
  m('interestCoverageRatio', 'financialHealth', false, 'x', 'interest_coverage_ratio'),
  m('quickRatio', 'financialHealth', false, 'x', 'quick_ratio'),
  m('freeCashFlowYield', 'efficiency', false, '%', `fcff / ${EV} × 100`, { priceBased: true }),
  m('cfoToRevenue', 'efficiency', false, '%', 'cfo / revenues × 100'),
  m('assetsTurnover', 'efficiency', false, 'x', 'assets_turnover'),
  m('receivablesTurnover', 'efficiency', false, 'x', 'receivables_turnover'),
  m('inventoryTurnover', 'efficiency', false, 'x', 'inventory_turnover'),
  m('revenueGrowth', 'growth', false, '%', 'revenue_growth_1y'),
  m('avgRevenueGrowth3y', 'growth', false, '%', 'avg_revenue_growth_3y', { rated: false, hiddenInQoq: true }),
  m('epsGrowth', 'growth', false, '%', 'eps_growth_%'),
  m('avgEpsGrowth3y', 'growth', false, '%', 'avg_eps_growth_3y', { rated: false, hiddenInQoq: true }),
  m('assetsGrowth', 'growth', false, '%', 'assets_growth_1y'),
  m('equityGrowth', 'growth', false, '%', 'equity_growth_1y'),
  m('roe', 'profitability', false, '%', 'roe_%', { rated: false }),
  m('roa', 'profitability', false, '%', 'roa_%', { rated: false }),
  m('roic', 'profitability', false, '%', 'roic_%'),
  m('grossMargin', 'profitability', false, '%', 'gross_margin_%', { rated: false }),
  m('operatingMargin', 'profitability', false, '%', 'operating_margin_%'),
  m('netMargin', 'profitability', false, '%', 'net_margin_%'),
  m('roae', 'profitability', false, '%', 'roae_%'),
  m('pe', 'valuation', true, 'x', 'price / eps (left out when negative)', { priceBased: true }),
  m(
    'pb',
    'valuation',
    true,
    'x',
    `${MARKET_CAP} / (total_equity − minority_interest_bs), else price / bvps`,
    { priceBased: true },
  ),
  m('evEbitda', 'valuation', true, 'x', `${EV} / ebitda`, { priceBased: true }),
  m('ps', 'valuation', true, 'x', `${MARKET_CAP} / revenues`, { rated: false, priceBased: true }),
  m('peg', 'valuation', true, 'x', 'P/E / eps_growth_%', { rated: false, priceBased: true }),
  m('dividendYield', 'valuation', false, '%', 'marketwatch dividend_yield_perc (today)', { rated: false }),
]);

/**
 * One company's value of every comparison metric, computed like ThndrX: the last reported value of each series,
 * valuation multiples at `market.price` against the latest period (see {@link valuation}; ThndrX passes the
 * period-end close for the company itself and the current price for its peers), free-cash-flow yield = FCFF /
 * (market cap + debt − cash − short-term investments) and CFO / revenue (both expressed here in percent; ThndrX shows
 * the bare ratio).
 */
export function comparisonValues(
  statements: FinancialStatements,
  market: MarketFigures,
): Record<string, number | null> {
  const last = (key: string) => latestValue(statements, key);
  const v = valuation(statements, market);
  const firmValue =
    (v.marketCap ?? 0) +
    (last('total_debt') ?? 0) -
    (last('total_cash_and_cash_equivalents') ?? 0) -
    (last('st_investments') ?? 0);
  const percent = (value: number | null) => (value === null ? null : value * 100);
  return {
    netDebtTotalEquity: last('net_debt_total_equity'),
    netDebtEbitda: last('net_debt_ebitda'),
    interestCoverageRatio: last('interest_coverage_ratio'),
    quickRatio: last('quick_ratio'),
    freeCashFlowYield: percent(ratio(last('fcff'), firmValue)),
    cfoToRevenue: percent(ratio(last('cfo'), last('revenues'))),
    assetsTurnover: last('assets_turnover'),
    receivablesTurnover: last('receivables_turnover'),
    inventoryTurnover: last('inventory_turnover'),
    revenueGrowth: last('revenue_growth_1y'),
    avgRevenueGrowth3y: last('avg_revenue_growth_3y'),
    epsGrowth: last('eps_growth_%'),
    avgEpsGrowth3y: last('avg_eps_growth_3y'),
    assetsGrowth: last('assets_growth_1y'),
    equityGrowth: last('equity_growth_1y'),
    roe: last('roe_%'),
    roa: last('roa_%'),
    roic: last('roic_%'),
    grossMargin: last('gross_margin_%'),
    operatingMargin: last('operating_margin_%'),
    netMargin: last('net_margin_%'),
    roae: last('roae_%'),
    pe: v.peRatio,
    pb: v.pbRatio,
    evEbitda: v.evEbitda,
    ps: v.psRatio,
    peg: v.pegRatio,
    dividendYield: market.dividendYieldPercent,
  };
}

export interface SectorStats {
  median: number | null;
  min: number | null;
  max: number | null;
}

/** Median, min and max of a sample (ThndrX `s2`). */
export function sectorStats(values: readonly number[]): SectorStats {
  if (values.length === 0) return { median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
      : (sorted[mid] as number);
  return { median, min: sorted[0] as number, max: sorted[sorted.length - 1] as number };
}

/**
 * Percentile rank 1–100 of `value` among the sector's values (ascending), ThndrX's formula: the average rank of
 * `value` (ties share their mean rank) scaled to 1–100, reversed when lower is better, so 100 is always best.
 * Null with fewer than two values.
 */
export function percentileRank(
  value: number | null,
  sortedValues: readonly number[],
  lowerIsBetter: boolean,
): number | null {
  const n = sortedValues.length;
  if (value === null || n < 2) return null;
  let rank = 1;
  for (const v of sortedValues) {
    if (v < value) rank++;
    else break;
  }
  let ties = 0;
  for (let i = rank - 1; i < n; i++) {
    if (sortedValues[i] === value) ties++;
    else break;
  }
  const average = rank + (ties - 1) / 2;
  return 1 + ((lowerIsBetter ? n + 1 - average : average) - 1) * (99 / (n - 1));
}

/** ThndrX's colour bands for a rating: > 80 green, ≥ 60 lightGreen, ≥ 40 yellow, ≥ 20 orange, else red. */
export type RatingBand = 'green' | 'lightGreen' | 'yellow' | 'orange' | 'red';

export function ratingBand(percentile: number): RatingBand {
  if (percentile > 80) return 'green';
  if (percentile >= 60) return 'lightGreen';
  if (percentile >= 40) return 'yellow';
  if (percentile >= 20) return 'orange';
  return 'red';
}

export interface MetricComparison {
  key: string;
  category: ComparisonCategory;
  unit: '%' | 'x';
  lowerIsBetter: boolean;
  /** The Thndr metric key, or how the value is derived. */
  source: string;
  value: number | null;
  /** Sector values used (non-zero values of every sector company Thndr has data for, this one included). */
  sectorCount: number;
  median: number | null;
  min: number | null;
  max: number | null;
  percentile: number | null;
}

export interface CategoryRating {
  category: ComparisonCategory;
  percentile: number;
  band: RatingBand;
}

export interface SectorComparisonResult {
  metrics: MetricComparison[];
  ratings: CategoryRating[];
}

/** A company of the sector: its financial statements and market figures. */
export interface SectorMember {
  statements: FinancialStatements;
  market: MarketFigures;
}

/**
 * Compares one company with its sector the way ThndrX's "metrics details" panel does: every metric's value against
 * the median/min/max of the sector companies' values (zero and missing values left out), a percentile rank, and per
 * category the rounded mean percentile of the rated metrics (banded on the unrounded mean). `company.market.price`
 * is the company's valuation price; the sector members (the company among them) carry their current price.
 */
export function compareWithSector(
  company: SectorMember,
  sector: readonly SectorMember[],
  mode: FinancialMode,
): SectorComparisonResult {
  const own = comparisonValues(company.statements, company.market);
  const peers = sector.map((member) => comparisonValues(member.statements, member.market));
  const metrics: MetricComparison[] = [];
  for (const metric of COMPARISON_METRICS) {
    if (mode === 'qoq' && metric.hiddenInQoq) continue;
    const values = peers
      .map((p) => p[metric.key])
      .filter((v): v is number => typeof v === 'number' && v !== 0 && !Number.isNaN(v));
    const sorted = [...values].sort((a, b) => a - b);
    const value = own[metric.key] ?? null;
    metrics.push({
      key: metric.key,
      category: metric.category,
      unit: metric.unit,
      lowerIsBetter: metric.lowerIsBetter,
      source: metric.source,
      value,
      sectorCount: values.length,
      ...sectorStats(values),
      percentile: percentileRank(value, sorted, metric.lowerIsBetter),
    });
  }
  const ratings: CategoryRating[] = [];
  for (const category of COMPARISON_CATEGORIES) {
    const scores = metrics
      .filter((x) => x.category === category && x.percentile !== null)
      .filter((x) => COMPARISON_METRICS.find((d) => d.key === x.key)?.rated)
      .map((x) => x.percentile as number);
    if (scores.length === 0) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    ratings.push({ category, percentile: Math.round(mean), band: ratingBand(mean) });
  }
  return { metrics, ratings };
}
