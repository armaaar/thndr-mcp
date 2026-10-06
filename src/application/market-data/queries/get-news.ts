import { z } from 'zod';
import {
  dedupeNews,
  MARKET_NEWS_MARKETS,
  NEWS_LOCALES,
  type NewsLocale,
} from '../../../domain/market-data/research';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, pageInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_CONTENT_CHARS = 500;
/** Thndr serves 25 articles per page. */
const PAGE_SIZE = 25;

const input = {
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe('Ticker (e.g. "COMI") or Thndr asset id; omit for market-wide news'),
  market: marketInput.describe(
    'Market used to resolve `symbol`. Without `symbol`: "us" gives US market news; any other market gives ' +
      'Thndr’s mixed feed of every market (EGX and US items)',
  ),
  page: pageInput.describe('Page number (25 articles per page, newest first)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE)
    .default(PAGE_SIZE)
    .describe('Return only the first N articles of the page (1–25, default 25), e.g. 2 for the latest two'),
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
  /** The market of market-wide news when Thndr has a feed for it (US); null for an instrument or the mixed feed. */
  market: string | null;
  locale: NewsLocale;
  page: number;
  /** Articles matching the query across all pages, as Thndr counts them. */
  total: number | null;
  hasMore: boolean;
  /** Repeated articles dropped from this page (Thndr lists some filings twice, with and without the PDF link). */
  duplicatesRemoved: number;
  items: NewsItemView[];
}

export class GetNews extends Query<typeof input, NewsView> {
  readonly name = 'get_news';
  readonly title = 'News';
  readonly description =
    'All markets: news and exchange disclosures from Thndr’s feed, newest first, for one instrument (UAE ' +
    'instruments may have none). Without `symbol`: US market news for `market: "us"`, else Thndr’s mixed feed of ' +
    'every market (EGX and US). 25 per page, repeated filings removed; `limit` keeps the first N. Content is ' +
    'truncated to `contentChars` (default 500) — follow `link` for the full text (EGX disclosures are PDFs).';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<NewsView> {
    const locale = params.locale ?? 'en';
    const page = params.page ?? 1;
    const maxChars = params.contentChars ?? DEFAULT_CONTENT_CHARS;
    const market = parseMarket(params.market);
    const instrument = params.symbol ? await this.deps.resolver.resolve(params.symbol, market) : null;
    const ownFeed = !instrument && MARKET_NEWS_MARKETS.includes(market) ? market : null;
    const result = await this.deps.research.getNews({
      assetId: instrument?.id,
      ...(ownFeed ? { market: ownFeed } : {}),
      locale,
      page,
    });
    const unique = dedupeNews(result.articles);
    const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), PAGE_SIZE);
    return {
      ticker: instrument?.ticker.value ?? null,
      market: ownFeed,
      locale,
      page,
      total: result.total,
      hasMore: result.hasMore || unique.length > limit,
      duplicatesRemoved: result.articles.length - unique.length,
      items: unique.slice(0, limit).map((article) => {
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
