import { z } from 'zod';
import { NEWS_LOCALES, type NewsLocale } from '../../../domain/market-data/research';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, pageInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_CONTENT_CHARS = 500;

const input = {
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe('Ticker (e.g. "COMI") or Thndr asset id; omit for market-wide news (all of Thndr’s markets)'),
  market: marketInput.describe(
    'Market used only to resolve `symbol`; market-wide news cannot be filtered by market (Thndr’s feed mixes ' +
      'EGX and US items)',
  ),
  page: pageInput.describe('Page number (25 articles per page, newest first)'),
  locale: z.enum(NEWS_LOCALES).default('en').describe('"en" (default) or "ar"'),
  contentChars: z
    .number()
    .int()
    .min(0)
    .max(20_000)
    .default(DEFAULT_CONTENT_CHARS)
    .describe(
      `Truncate each article's content to N characters (default ${DEFAULT_CONTENT_CHARS}; 0 omits it)`,
    ),
};

export interface NewsItemView {
  id: string;
  title: string;
  content?: string;
  /** True when `content` was cut to `contentChars`. */
  contentTruncated?: boolean;
  source: string | null;
  link: string | null;
  publishedAt: string | null;
  market: string | null;
  tickers: readonly string[];
}

export interface NewsView {
  ticker: string | null;
  locale: NewsLocale;
  page: number;
  /** Articles matching the query across all pages, as Thndr counts them. */
  total: number | null;
  hasMore: boolean;
  items: NewsItemView[];
}

export class GetNews extends Query<typeof input, NewsView> {
  readonly name = 'get_news';
  readonly title = 'News';
  readonly description =
    'News and exchange disclosures from Thndr’s feed, newest first: for one instrument, or market-wide when ' +
    '`symbol` is omitted (every Thndr market mixed: EGX and US; `market` does not filter it). 25 per page; content is truncated to `contentChars` (default 500) — follow `link` for ' +
    'the full text (EGX disclosures are PDFs).';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<NewsView> {
    const locale = params.locale ?? 'en';
    const page = params.page ?? 1;
    const maxChars = params.contentChars ?? DEFAULT_CONTENT_CHARS;
    const instrument = params.symbol
      ? await this.deps.resolver.resolve(params.symbol, parseMarket(params.market))
      : null;
    const result = await this.deps.research.getNews({ assetId: instrument?.id, locale, page });
    return {
      ticker: instrument?.ticker.value ?? null,
      locale,
      page,
      total: result.total,
      hasMore: result.hasMore,
      items: result.articles.map((article) => {
        const truncated = article.content.length > maxChars;
        return {
          id: article.id,
          title: article.title,
          ...(maxChars > 0
            ? {
                content: truncated ? `${article.content.slice(0, maxChars).trimEnd()}…` : article.content,
                ...(truncated ? { contentTruncated: true } : {}),
              }
            : {}),
          source: article.source,
          link: article.link,
          publishedAt: article.publishedAt?.toISOString() ?? null,
          market: article.market,
          tickers: article.tickers,
        };
      }),
    };
  }
}
