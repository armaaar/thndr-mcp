import { describeFilter, SCREENER_PRESETS, type Screener } from '../../../domain/market-data/screener';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = { market: marketInput };

export interface ScreenerView {
  id: string;
  name: string;
  /** Filters in plain words, e.g. `value ≥ 1,000,000`. */
  filters: string[];
  /** Filters Thndr stored that thndr-mcp cannot evaluate; screen_market refuses such a screener. */
  unsupported: string[];
}

export interface Screeners {
  market: Market;
  /** The user's saved screeners (ThndrX → Screeners). */
  saved: ScreenerView[];
  /** ThndrX's built-in "recommended screeners". */
  presets: ScreenerView[];
}

function view(screener: Screener): ScreenerView {
  return {
    id: screener.id,
    name: screener.name,
    filters: screener.filters.map(describeFilter),
    unsupported: [...screener.unsupported],
  };
}

export class GetScreeners extends Query<typeof input, Screeners> {
  readonly name = 'get_screeners';
  readonly title = 'Screeners';
  readonly description =
    "The user's saved Thndr screeners and ThndrX's built-in presets, each with its id, name and filters in plain " +
    'words. Run one with screen_market (screenerId or preset).';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Screeners> {
    const market = parseMarket(params.market);
    const saved = await this.deps.repository.getScreeners(market);
    return { market, saved: saved.map(view), presets: SCREENER_PRESETS.map(view) };
  }
}
