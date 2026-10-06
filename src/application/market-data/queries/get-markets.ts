import {
  FEATURE_LABELS,
  MARKET_FEATURES,
  MARKET_PROFILES,
  type Market,
  type MarketFeature,
  marketSupports,
} from '../../../domain/shared-kernel/market';
import type { Currency } from '../../../domain/shared-kernel/money';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = {};

export interface MarketView {
  market: Market;
  name: string;
  currency: Currency;
  timeZone: string;
  /** Thndr restricts this market for the user (they cannot switch to it in the app). */
  restricted: boolean;
  restrictionReason: string | null;
  /** thndr-mcp features available in this market (keys of `features`). */
  supports: MarketFeature[];
  /** thndr-mcp features Thndr does not offer in this market; the matching tools answer FEATURE_DISABLED. */
  lacks: MarketFeature[];
}

export interface MarketsView {
  defaultMarket: Market | null;
  markets: MarketView[];
  /** Markets Thndr lists for the user that thndr-mcp does not serve yet, as Thndr names them. */
  otherThndrMarkets: string[];
  /** What each feature key means. */
  features: Record<MarketFeature, string>;
  note: string;
}

export class GetMarkets extends Query<typeof input, MarketsView> {
  readonly name = 'get_markets';
  readonly title = 'Markets';
  readonly description =
    'The Thndr markets this account can use (egypt, us, uae, simulator), the default one and any restriction, with ' +
    'each market’s exchange, currency and time zone and which thndr-mcp features work there (e.g. order book, ' +
    'candles and financials are Egypt-only; movers are Egypt and US). Call it to learn where a tool applies.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(_params: InputOf<typeof input>): Promise<MarketsView> {
    const access = await this.deps.discovery.getVisibleMarkets();
    return {
      defaultMarket: access.defaultMarket,
      markets: access.markets.map((visible) => {
        const profile = MARKET_PROFILES[visible.market];
        return {
          market: visible.market,
          name: profile.name,
          currency: profile.currency,
          timeZone: profile.timeZone,
          restricted: visible.restricted,
          restrictionReason: visible.restrictionReason,
          supports: MARKET_FEATURES.filter((feature) => marketSupports(visible.market, feature)),
          lacks: MARKET_FEATURES.filter((feature) => !marketSupports(visible.market, feature)),
        };
      }),
      otherThndrMarkets: [...access.otherMarkets],
      features: { ...FEATURE_LABELS },
      note:
        'Every market has instrument search and details, quotes (get_price_snapshot), price history ' +
        '(get_price_history: OHLC candles in Egypt, closing prices elsewhere), performance (get_price_performance), ' +
        'similar stocks (get_peers), news and dividends; outside Egypt quotes are thinner (no volume, limits or ' +
        'ratios) and there is no whole-market snapshot, order book or financials. The simulator is a paper-trading ' +
        'account on Egyptian and US instruments; their market data follows each instrument (Egyptian listings read ' +
        "Egypt's data).",
    };
  }
}
