import type {
  AssetYearlyReturnDto,
  FinancialsBatchDto,
  FinancialsDto,
  InflationPointDto,
  MacroReadingDto,
  MacrosDto,
  NewsItemDto,
  NewsResponseDto,
} from '../../../data-sources/thndr/dto/research';
import { parseTimestamp, toNumber } from '../../../data-sources/thndr/wire';
import {
  createFinancialStatements,
  type FinancialMode,
  type FinancialPoint,
  type FinancialStatements,
} from '../../../domain/market-data/financials';
import type {
  EconomicIndicators,
  InflationPoint,
  MacroReading,
  NewsArticle,
  NewsPage,
  YearlyReturn,
} from '../../../domain/market-data/research';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Maps one company's `/financials` payload; non-array fields other than `currency` are ignored. */
export function toFinancialStatements(
  dto: FinancialsDto | null | undefined,
  mode: FinancialMode,
): FinancialStatements {
  const series: Record<string, FinancialPoint[]> = {};
  if (isRecord(dto)) {
    for (const [key, raw] of Object.entries(dto)) {
      if (!Array.isArray(raw)) continue;
      series[key] = raw
        .filter((p) => isRecord(p) && typeof p.period === 'string')
        .map((p) => ({ period: p.period as string, value: toNumber(p.value) }));
    }
  }
  return createFinancialStatements({ currency: isRecord(dto) ? text(dto.currency) : null, mode, series });
}

/** Maps a batch `/financials?symbols=` payload keyed by symbol; entries without any series are dropped. */
export function toFinancialsBatch(
  dto: FinancialsBatchDto | null | undefined,
  mode: FinancialMode,
): Map<string, FinancialStatements> {
  const batch = new Map<string, FinancialStatements>();
  if (!isRecord(dto)) return batch;
  for (const [symbol, entry] of Object.entries(dto)) {
    const statements = toFinancialStatements(entry as FinancialsDto | null, mode);
    if (Object.keys(statements.series).length > 0) batch.set(symbol.toUpperCase(), statements);
  }
  return batch;
}

export function toNewsArticle(dto: NewsItemDto | null | undefined): NewsArticle | null {
  if (!isRecord(dto) || (typeof dto.id !== 'number' && typeof dto.id !== 'string')) return null;
  const tickers = (Array.isArray(dto.stocks) ? dto.stocks : [])
    .map((s) => (isRecord(s) ? text(s.symbol) : null))
    .filter((s): s is string => s !== null);
  return Object.freeze({
    id: String(dto.id),
    title: text(dto.title) ?? '',
    content: typeof dto.content === 'string' ? dto.content.trim() : '',
    source: text(dto.source),
    link: text(dto.link),
    publishedAt: parseTimestamp(dto.created_at),
    market: text(dto.market),
    tickers: Object.freeze(tickers),
  });
}

export function toNewsPage(dto: NewsResponseDto | null | undefined): NewsPage {
  const results = isRecord(dto) && Array.isArray(dto.results) ? dto.results : [];
  return Object.freeze({
    total: isRecord(dto) ? toNumber(dto.count) : null,
    hasMore: isRecord(dto) && text(dto.next) !== null,
    articles: Object.freeze(results.map(toNewsArticle).filter((a): a is NewsArticle => a !== null)),
  });
}

/** `headline_inflation_yearly` → `headlineInflationYearly`, `treasury_bills_12m` → `treasuryBills12m`. */
export function camelCase(key: string): string {
  return key.replace(/_+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const byDate = <T extends { date: string }>(points: T[]): T[] =>
  points.sort((a, b) => a.date.localeCompare(b.date));

function dated<D extends { date?: string | null }, T extends { date: string }>(
  rows: D[] | null | undefined,
  map: (row: D, date: string) => T,
): T[] {
  return byDate(
    (Array.isArray(rows) ? rows : [])
      .filter((r): r is D & { date: string } => isRecord(r) && text(r.date) !== null)
      .map((r) => map(r, r.date)),
  );
}

const inflation = (row: InflationPointDto, date: string): InflationPoint => ({
  date,
  headline: toNumber(row.headline),
  core: toNumber(row.core),
  goodsAndServices: toNumber(row.goods_and_services),
  fruitsAndVegetables: toNumber(row.fruits_and_vegetables),
});

function toReading(dto: MacroReadingDto): MacroReading | null {
  const value = toNumber(dto.value);
  if (value === null) return null;
  return { value, date: text(dto.date), period: text(dto.period), change: toNumber(dto.growth) };
}

/** Maps `/api/macros`. Overview readings are keyed by camel-cased names; series are sorted oldest first. */
export function toEconomicIndicators(dto: MacrosDto | null | undefined): EconomicIndicators {
  const data: MacrosDto = isRecord(dto) ? dto : {};
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const sources: Record<string, string> = {};
  for (const [key, value] of Object.entries(isRecord(metadata.sources) ? metadata.sources : {})) {
    if (typeof value === 'string') sources[camelCase(key)] = value;
  }
  const overview: Record<string, MacroReading> = {};
  let gdp: Record<string, number> | null = null;
  for (const [key, raw] of Object.entries(isRecord(data.overview) ? data.overview : {})) {
    if (!isRecord(raw)) continue;
    const reading = toReading(raw);
    if (reading) {
      overview[camelCase(key)] = reading;
      continue;
    }
    const figures: Record<string, number> = {};
    for (const [field, value] of Object.entries(raw)) {
      const n = toNumber(value);
      if (n !== null) figures[camelCase(field)] = n;
    }
    if (key === 'gdp' && Object.keys(figures).length > 0) gdp = figures;
  }
  const unemployment = (Array.isArray(data.unemployment) ? data.unemployment : [])
    .filter(isRecord)
    .map((row) => ({ year: toNumber(row.year), quarter: toNumber(row.quarter), rate: toNumber(row.rate) }))
    .filter(
      (row): row is { year: number; quarter: number; rate: number | null } =>
        row.year !== null && row.quarter !== null,
    )
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map((row) => ({ period: `Q${row.quarter} ${row.year}`, ...row }));
  return {
    description: text(metadata.description),
    extractedAt: text(metadata.extracted_at),
    sources,
    overview,
    gdp,
    inflationYearly: dated(data.inflation_yearly, inflation),
    inflationMonthly: dated(data.inflation_monthly, inflation),
    overnightRates: dated(data.overnight_rates, (row, date) => ({
      date,
      depositRate: toNumber(row.deposits_rate),
      lendingRate: toNumber(row.lending_rate),
    })),
    treasuryBills: dated(data.treasury_bills, (row, date) => ({
      date,
      oneMonth: toNumber(row['1m_return']),
      threeMonths: toNumber(row['3m_return']),
      sixMonths: toNumber(row['6m_return']),
      nineMonths: toNumber(row['9m_return']),
      twelveMonths: toNumber(row['12m_return']),
    })),
    unemployment,
  };
}

export function toYearlyReturn(dto: AssetYearlyReturnDto | null | undefined): YearlyReturn | null {
  const raw = isRecord(dto) && isRecord(dto.annual_return) ? dto.annual_return : null;
  const percent = raw ? toNumber(raw.value) : null;
  if (!raw || percent === null) return null;
  return Object.freeze({ percent, direction: text(raw.return) });
}
