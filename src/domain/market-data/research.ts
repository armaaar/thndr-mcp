/** Research content Thndr publishes besides prices: news, Egypt's macro indicators and its own one-year return. */

export const NEWS_LOCALES = ['en', 'ar'] as const;
export type NewsLocale = (typeof NEWS_LOCALES)[number];

/** A news item or exchange disclosure from Thndr's news feed. */
export interface NewsArticle {
  readonly id: string;
  readonly title: string;
  /** Summary or body as Thndr serves it ('' for many exchange disclosures, whose text is behind `link`). */
  readonly content: string;
  /** Publisher, e.g. "egx" (exchange disclosures) or a news outlet. */
  readonly source: string | null;
  readonly link: string | null;
  readonly publishedAt: Date | null;
  /** Market of the article ("egypt", "us"). */
  readonly market: string | null;
  /** Tickers the article is tagged with. */
  readonly tickers: readonly string[];
}

/**
 * Drops repeated articles, keeping the first position of each. Thndr lists some exchange filings twice — once with the
 * PDF link and once without — so articles with the same title (ignoring case and spacing), publication time and tickers
 * are one article: the copy with a link wins, then the one with more content. Articles without a title or a time are
 * never merged.
 */
export function dedupeNews(articles: readonly NewsArticle[]): NewsArticle[] {
  const keyOf = (a: NewsArticle, index: number) => {
    const title = a.title.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!title || !a.publishedAt) return `#${index}`;
    return `${title}|${a.publishedAt.getTime()}|${[...a.tickers].sort().join(',')}`;
  };
  const better = (a: NewsArticle, b: NewsArticle) =>
    a.link === null && b.link !== null
      ? true
      : (a.link === null) === (b.link === null) && b.content.length > a.content.length;
  const order: string[] = [];
  const kept = new Map<string, NewsArticle>();
  for (const [index, article] of articles.entries()) {
    const key = keyOf(article, index);
    const current = kept.get(key);
    if (!current) {
      order.push(key);
      kept.set(key, article);
    } else if (better(current, article)) {
      kept.set(key, article);
    }
  }
  return order.map((key) => kept.get(key) as NewsArticle);
}

export interface NewsPage {
  readonly total: number | null;
  readonly hasMore: boolean;
  readonly articles: readonly NewsArticle[];
}

/** One headline macro reading (Thndr `macros.overview`). `change` is Thndr's `growth`: change from the prior reading. */
export interface MacroReading {
  readonly value: number;
  /** Day of the reading (ISO date) or the period it covers (e.g. "Q2 2026"). */
  readonly date: string | null;
  readonly period: string | null;
  readonly change: number | null;
}

/** Dated macro series point; values in percent. */
export interface InflationPoint {
  readonly date: string;
  readonly headline: number | null;
  readonly core: number | null;
  readonly goodsAndServices: number | null;
  readonly fruitsAndVegetables: number | null;
}

export interface OvernightRatesPoint {
  readonly date: string;
  readonly depositRate: number | null;
  readonly lendingRate: number | null;
}

/** Average treasury-bill returns by tenor, in percent. */
export interface TreasuryBillsPoint {
  readonly date: string;
  readonly oneMonth: number | null;
  readonly threeMonths: number | null;
  readonly sixMonths: number | null;
  readonly nineMonths: number | null;
  readonly twelveMonths: number | null;
}

export interface UnemploymentPoint {
  /** "Q1 2020". */
  readonly period: string;
  readonly year: number;
  readonly quarter: number;
  readonly rate: number | null;
}

/** Egypt's macroeconomic data as ThndrX shows it (x.thndr.app `/api/macros`). Series are oldest first. */
export interface EconomicIndicators {
  readonly description: string | null;
  /** When Thndr extracted the data. */
  readonly extractedAt: string | null;
  /** Series name → Thndr's description of its source. */
  readonly sources: Readonly<Record<string, string>>;
  /** Headline readings by name (headlineInflationYearly, depositRate, treasuryBills12m…). */
  readonly overview: Readonly<Record<string, MacroReading>>;
  /** GDP figures (gdpEgp, gdpUsd, gdpGrowthEgp, gdpGrowthUsd), when reported. */
  readonly gdp: Readonly<Record<string, number>> | null;
  readonly inflationYearly: readonly InflationPoint[];
  readonly inflationMonthly: readonly InflationPoint[];
  readonly overnightRates: readonly OvernightRatesPoint[];
  readonly treasuryBills: readonly TreasuryBillsPoint[];
  readonly unemployment: readonly UnemploymentPoint[];
}

/** Thndr's own one-year return of an instrument (asset details `annual_return`). */
export interface YearlyReturn {
  /** Percent, as Thndr reports it. */
  readonly percent: number;
  /** Thndr's direction label: "gain", "loss" or another value. */
  readonly direction: string | null;
}
