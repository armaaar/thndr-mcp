import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { type TagView, toTagView } from '../listing-views';

const input = { market: marketInput.describe('Market: "egypt" (default) or "us"') };

export interface TagsView {
  market: Market;
  tags: TagView[];
}

export class GetTags extends Query<typeof input, TagsView> {
  readonly name = 'get_tags';
  readonly title = 'Tags (themes)';
  readonly description =
    'Thndr’s tags (the app calls them themes) for a market: curated groups such as "Sharia", "Gold Funds" or ' +
    '"Dividend Players", with what each is about and how many instruments it has. List a tag’s instruments with ' +
    'get_tag_instruments; get_instrument_details shows the tags of one instrument. Egypt and US.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<TagsView> {
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'tags');
    const tags = await this.deps.discovery.getTags(market);
    return { market, tags: tags.map(toTagView) };
  }
}
