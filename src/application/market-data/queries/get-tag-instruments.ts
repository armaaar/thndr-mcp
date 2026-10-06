import { z } from 'zod';
import { findTag } from '../../../domain/market-data/discovery';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { NotFoundError } from '../../errors';
import { marketInput, pageInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { type ListedInstrumentView, type TagView, toListedInstrumentView, toTagView } from '../listing-views';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const input = {
  tag: z
    .string()
    .trim()
    .min(1)
    .describe('Tag id (e.g. "157"), slug or name (e.g. "sharia", "Gold Funds"), as get_tags lists them'),
  market: marketInput.describe(
    'Market: "egypt" (default) or "us" — a tag lists the instruments of one market',
  ),
  page: pageInput.describe('Page number (1-based)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Instruments per page (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
};

export interface TagInstrumentsView {
  market: Market;
  tag: TagView;
  page: number;
  pageSize: number;
  /** Instruments in the tag across all pages, as Thndr counts them. */
  total: number | null;
  hasMore: boolean;
  instruments: ListedInstrumentView[];
}

export class GetTagInstruments extends Query<typeof input, TagInstrumentsView> {
  readonly name = 'get_tag_instruments';
  readonly title = 'Tag instruments';
  readonly description =
    'The instruments of one Thndr tag (theme) in a market — e.g. every Sharia-compliant EGX stock or Thndr’s gold ' +
    'funds — with price and today’s change, paged. Give the tag’s id, slug or name (see get_tags). Egypt and US.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<TagInstrumentsView> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'tags');
    const page = params.page ?? 1;
    const pageSize = params.limit ?? DEFAULT_LIMIT;
    const tagId = await this.resolveTagId(params.tag, market);
    const result = await this.deps.discovery.getTagInstruments(tagId, market, { page, pageSize });
    const total = result.tag.instrumentCount;
    return {
      market,
      tag: toTagView(result.tag),
      page,
      pageSize,
      total,
      hasMore: total !== null ? page * pageSize < total : result.instruments.length >= pageSize,
      instruments: result.instruments.slice(0, pageSize).map(toListedInstrumentView),
    };
  }

  /** A numeric id is used as is; a slug or name is looked up in the market's tags. */
  private async resolveTagId(query: string, market: Market): Promise<string> {
    if (/^\d+$/.test(query)) return query;
    const tags = await this.deps.discovery.getTags(market);
    const tag = findTag(tags, query);
    if (tag) return tag.id;
    const names = tags.map((t) => t.name).join(', ');
    throw new NotFoundError(
      `No ${market} tag matches "${query}".${names ? ` Tags: ${names}.` : ''} Use get_tags for ids.`,
    );
  }
}
