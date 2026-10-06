import { z } from 'zod';
import {
  DEFAULT_FINANCIAL_METRICS,
  FINANCIAL_MODES,
  type FinancialMode,
  type FinancialPoint,
  type FinancialStatements,
  latestPeriod,
  type MarketFigures,
} from '../../../domain/market-data/financials';
import type { Quote } from '../../../domain/market-data/instrument';
import {
  type CategoryRating,
  compareWithSector,
  type MetricComparison,
  type SectorMember,
} from '../../../domain/market-data/sector-comparison';
import { roundTo } from '../../../domain/shared-kernel/guards';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_PERIODS = 8;

const MODE_BASIS: Record<FinancialMode, string> = {
  ttm: 'Trailing twelve months at each quarter end ("TTM Q2 26"): flows (revenue, income, cash flow) are 12-month sums.',
  qoq: 'Single quarters ("Q2 26"): flows cover one quarter, so ratios on them (and P/E) are not annual.',
  yoy: 'Fiscal years ("2025").',
};

const input = {
  symbol: symbolInput,
  market: marketInput,
  mode: z
    .enum(FINANCIAL_MODES)
    .default('ttm')
    .describe(
      '"ttm" trailing twelve months (default, comparable across companies), "qoq" single quarters, "yoy" fiscal years',
    ),
  metrics: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Thndr metric keys, e.g. revenues, net_income, eps, total_assets, roe_%, net_margin_%, revenue_growth_1y, ' +
        'customer_deposits (banks); ["all"] for every metric Thndr reports. Default: a compact core set.',
    ),
  periods: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe(`Most recent N periods per metric (default ${DEFAULT_PERIODS})`),
  compareToSector: z
    .boolean()
    .default(false)
    .describe('Also rank the company against its sector the way ThndrX does (median/min/max and percentile)'),
};

export interface FinancialMetricView {
  latest: FinancialPoint | null;
  series: FinancialPoint[];
}

export interface SectorComparisonView {
  sector: string;
  /** Sector companies with listed shares (the ThndrX peer set, this company included). */
  companies: number;
  /** Of those, how many Thndr returned financials for. */
  companiesWithData: number;
  method: string;
  ratings: CategoryRating[];
  metrics: MetricComparison[];
}

export interface FinancialsView {
  ticker: string;
  name: string;
  currency: string | null;
  mode: FinancialMode;
  basis: string;
  latestPeriod: string | null;
  units: string;
  metrics: Record<string, FinancialMetricView>;
  /** Requested metrics Thndr does not report for this company. */
  unavailable?: string[];
  /** Every metric key Thndr reports for this company (pass them in `metrics`). */
  availableMetrics: string[];
  sectorComparison?: SectorComparisonView | null;
  notes?: string[];
}

const COMPARISON_METHOD =
  'As ThndrX computes it: the peers are every company of the same marketwatch sector with listed shares (this one ' +
  'included); each metric is the last reported value (valuation multiples at today’s price against the latest ' +
  'period); median/min/max ignore zero and missing values; percentile 1–100 is the company’s average rank among ' +
  'those values (100 = best; reversed when lower is better); each category rating is the rounded mean percentile of ' +
  'its rated metrics, banded green > 80, lightGreen ≥ 60, yellow ≥ 40, orange ≥ 20, red < 20.';

const figures = (quote: Quote): MarketFigures => ({
  price: quote.last,
  listedShares: quote.listedShares,
  dividendYieldPercent: quote.dividendYieldPercent,
});

const round = (value: number | null) => (value === null ? null : roundTo(value, 4));

export class GetFinancials extends Query<typeof input, FinancialsView> {
  readonly name = 'get_financials';
  readonly title = 'Company financials';
  readonly description =
    'Financial statements and ratios of a listed company from Thndr (balance sheet, income statement, cash flow, ' +
    'profitability, leverage, growth, per-share data) by period, with each metric’s latest value. ' +
    '`compareToSector` adds ThndrX’s sector comparison: per metric the sector median/min/max and a percentile rank.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<FinancialsView> {
    const mode = params.mode ?? 'ttm';
    const periods = params.periods ?? DEFAULT_PERIODS;
    const market = parseMarket(params.market);
    const instrument = await this.deps.resolver.resolve(params.symbol, market);
    const statements = await this.deps.research.getFinancials(instrument.ticker, mode, periods);

    const available = Object.keys(statements.series);
    const requested = params.metrics ?? DEFAULT_FINANCIAL_METRICS;
    const keys = requested.some((k) => k.toLowerCase() === 'all') ? available : requested;
    const metrics: Record<string, FinancialMetricView> = {};
    for (const key of keys) {
      const series = statements.series[key];
      if (!series) continue;
      metrics[key] = { latest: series.at(-1) ?? null, series: series.slice(-periods) };
    }
    const unavailable = params.metrics ? keys.filter((k) => !statements.series[k]) : [];

    const view: FinancialsView = {
      ticker: instrument.ticker.value,
      name: instrument.name,
      currency: statements.currency,
      mode,
      basis: MODE_BASIS[mode],
      latestPeriod: latestPeriod(statements),
      units:
        'Amounts in `currency`; keys ending in `_%` and growth rates are percent; ratios and turnovers are multiples.',
      metrics,
      ...(unavailable.length ? { unavailable } : {}),
      availableMetrics: available,
    };
    if (params.compareToSector)
      Object.assign(view, await this.sectorComparison(instrument.id.value, statements, market, mode));
    return view;
  }

  private async sectorComparison(
    assetId: string,
    own: FinancialStatements,
    market: Market,
    mode: FinancialMode,
  ): Promise<Pick<FinancialsView, 'sectorComparison' | 'notes'>> {
    const quotes = await this.deps.quotes.get(market);
    const quote = quotes.find((q) => q.instrumentId.value === assetId);
    const sector = quote?.sector;
    if (!quote || !sector) {
      return {
        sectorComparison: null,
        notes: ['Thndr lists no sector for this instrument, so it cannot be compared.'],
      };
    }
    const peers = quotes.filter((q) => q.sector === sector && (q.listedShares ?? 0) > 0);
    const batch = await this.deps.research.getFinancialsBatch(
      peers.map((q) => q.ticker),
      mode,
    );
    const members: SectorMember[] = peers.flatMap((q) => {
      const statements = batch.get(q.ticker.value);
      return statements ? [{ statements, market: figures(q) }] : [];
    });
    const company: SectorMember = {
      statements: batch.get(quote.ticker.value) ?? own,
      market: figures(quote),
    };
    const result = compareWithSector(company, members, mode);
    const notes = sector.toLowerCase().includes('banks')
      ? [
          'ThndrX does not show this comparison for banks (many ratios do not apply to them); it is computed the same way here.',
        ]
      : undefined;
    return {
      sectorComparison: {
        sector,
        companies: peers.length,
        companiesWithData: members.length,
        method: COMPARISON_METHOD,
        ratings: result.ratings,
        metrics: result.metrics.map((metric) => ({
          ...metric,
          value: round(metric.value),
          median: round(metric.median),
          min: round(metric.min),
          max: round(metric.max),
          percentile: metric.percentile === null ? null : Math.round(metric.percentile),
        })),
      },
      ...(notes ? { notes } : {}),
    };
  }
}
