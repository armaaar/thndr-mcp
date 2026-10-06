import { z } from 'zod';
import type { Candle } from '../../../domain/market-data/candle';
import {
  DEFAULT_FINANCIAL_METRICS,
  FINANCIAL_MODES,
  type FinancialMode,
  type FinancialPoint,
  type FinancialStatements,
  latestPeriod,
  type MarketFigures,
  VALUATION_PRICE_YEARS,
  type ValuationPrice,
  valuationPrice,
} from '../../../domain/market-data/financials';
import type { Instrument, Quote } from '../../../domain/market-data/instrument';
import {
  type CategoryRating,
  COMPARISON_METRICS,
  compareWithSector,
  type MetricComparison,
  type SectorMember,
} from '../../../domain/market-data/sector-comparison';
import { roundTo } from '../../../domain/shared-kernel/guards';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { UpstreamError } from '../../errors';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_PERIODS = 8;
const DAY_MS = 86_400_000;

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
        'customer_deposits (banks); ["all"] for every metric Thndr reports. Default: a compact core set. Thndr ' +
        'serves no valuation multiples (pe_ratio, pb_ratio, ev_ebitda…): use compareToSector for P/E, P/B, P/S, ' +
        'PEG, EV/EBITDA. Does not affect the sector comparison, which always covers every metric ThndrX compares.',
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
    .describe(
      'Also rank the company against its sector the way ThndrX does (median/min/max and percentile) on ThndrX’s ' +
        'full metric set, including the derived valuation multiples',
    ),
};

export interface FinancialMetricView {
  latest: FinancialPoint | null;
  series: FinancialPoint[];
}

/** A compared metric; price-based ones say which price valued the company. */
export type MetricComparisonView = MetricComparison & {
  companyPrice?: ValuationPrice['basis'];
};

export interface SectorComparisonView {
  sector: string;
  /** Sector companies with listed shares (the ThndrX peer set, this company included). */
  companies: number;
  /** Of those, how many Thndr returned financials for. */
  companiesWithData: number;
  method: string;
  /** The price the company's own price-based metrics use (peers always use the current price). */
  valuationPrice: ValuationPrice;
  ratings: CategoryRating[];
  metrics: MetricComparisonView[];
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
  'included); each metric is the last reported value; valuation multiples and free-cash-flow yield are derived ' +
  '(Thndr serves no multiples) against the latest period — for this company at the close of the last daily candle ' +
  'on or before the end of that period (quarters end 31 Mar/30 Jun/30 Sep/31 Dec, years 31 Dec; see ' +
  '`valuationPrice`; when no candle reaches back that far we use the current price and say so, where ThndrX shows ' +
  'nothing), for the peers (this company’s own entry among them included) at the current price; median/min/max ' +
  'ignore zero and missing values; percentile 1–100 is the company’s average rank among those values (100 = best; ' +
  'reversed when lower is better; a price-based value priced differently from its own sample entry can land ' +
  'slightly outside 1–100, as in ThndrX); each category rating is the rounded mean percentile of its rated ' +
  'metrics, banded on the unrounded mean: green > 80, lightGreen ≥ 60, yellow ≥ 40, orange ≥ 20, red < 20. The ' +
  'comparison always covers every metric ThndrX compares, whatever `metrics` asks for; `source` names the Thndr key or ' +
  'formula behind each value.';

const CURRENT_PRICE_NOTES: Record<NonNullable<ValuationPrice['reason']>, string> = {
  noPeriod:
    'The latest period has no recognisable end date, so the company’s valuation multiples use the current price.',
  noCandles:
    'Thndr returned no daily candles, so the company’s valuation multiples use the current price (as ThndrX does then).',
  beforeHistory:
    'Thndr’s daily candles do not reach back to the end of the latest period, so the company’s valuation multiples ' +
    'use the current price; ThndrX leaves them empty in that case.',
};

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
      Object.assign(view, await this.sectorComparison(instrument, statements, market, mode));
    return view;
  }

  private async sectorComparison(
    instrument: Instrument,
    own: FinancialStatements,
    market: Market,
    mode: FinancialMode,
  ): Promise<Pick<FinancialsView, 'sectorComparison' | 'notes'>> {
    const quotes = await this.deps.quotes.get(market);
    const quote = quotes.find((q) => q.instrumentId.value === instrument.id.value);
    const sector = quote?.sector;
    if (!quote || !sector) {
      return {
        sectorComparison: null,
        notes: ['Thndr lists no sector for this instrument, so it cannot be compared.'],
      };
    }
    const peers = quotes.filter((q) => q.sector === sector && (q.listedShares ?? 0) > 0);
    let batch: Map<string, FinancialStatements>;
    try {
      batch = await this.deps.research.getFinancialsBatch(
        peers.map((q) => q.ticker),
        mode,
      );
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      return {
        sectorComparison: null,
        notes: [
          `Thndr did not return the sector’s financials (${error.message}), so the company cannot be compared; try again later.`,
        ],
      };
    }
    const members: SectorMember[] = peers.flatMap((q) => {
      const statements = batch.get(q.ticker.value);
      return statements ? [{ statements, market: figures(q) }] : [];
    });
    const statements = batch.get(quote.ticker.value) ?? own;
    const candles = await this.valuationCandles(instrument, mode);
    const price = valuationPrice(statements, candles ?? [], quote.last);
    const company: SectorMember = { statements, market: { ...figures(quote), price: price.price } };
    const result = compareWithSector(company, members, mode);
    const notes: string[] = [];
    if (sector.toLowerCase().includes('banks'))
      notes.push(
        'ThndrX does not show this comparison for banks (many ratios do not apply to them); it is computed the same way here.',
      );
    if (candles === null)
      notes.push(
        'Thndr’s daily candles could not be loaded, so the company’s valuation multiples use the current price (as ThndrX does then).',
      );
    else if (price.reason) notes.push(CURRENT_PRICE_NOTES[price.reason]);
    const priceBased = new Set(COMPARISON_METRICS.filter((d) => d.priceBased).map((d) => d.key));
    return {
      sectorComparison: {
        sector,
        companies: peers.length,
        companiesWithData: members.length,
        method: COMPARISON_METHOD,
        valuationPrice: { ...price, price: round(price.price) },
        ratings: result.ratings,
        metrics: result.metrics.map((metric) => ({
          ...metric,
          value: round(metric.value),
          median: round(metric.median),
          min: round(metric.min),
          max: round(metric.max),
          percentile: metric.percentile === null ? null : Math.round(metric.percentile),
          ...(priceBased.has(metric.key) ? { companyPrice: price.basis } : {}),
        })),
      },
      ...(notes.length ? { notes } : {}),
    };
  }

  /** The daily candles ThndrX loads to price the company (3 years, 8 for `yoy`); null when Thndr fails. */
  private async valuationCandles(instrument: Instrument, mode: FinancialMode): Promise<Candle[] | null> {
    const to = this.deps.clock.now();
    const from = new Date(to.getTime() - VALUATION_PRICE_YEARS[mode] * 365 * DAY_MS);
    try {
      return await this.deps.repository.getCandles(instrument.id, '1d', from, to);
    } catch (error) {
      if (error instanceof UpstreamError) return null;
      throw error;
    }
  }
}
