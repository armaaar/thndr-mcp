import { type Market, parseMarket } from '../../../domain/market-data/market';
import { marketInput, pageInput, symbolInput } from '../../inputs';
import { clamp } from '../../paging';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { pageCountInput } from '../inputs';
import { toAlertViews } from '../price-alerts';
import type { AlertView } from '../views';

const input = {
  market: marketInput,
  symbol: symbolInput.optional(),
  page: pageInput,
  pageCount: pageCountInput,
};

type Output = {
  market: Market;
  page: number;
  pageCount: number;
  hasMore: boolean;
  alerts: AlertView[];
};

/** IBKR `get_alerts`: one page of the market's alerts, or every alert of one symbol. */
export class GetAlerts extends Query<typeof input, Output> {
  readonly name = 'get_alerts';
  readonly title = 'Price alerts';
  readonly description = 'Price alerts of the account, optionally only for one instrument. Paged.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const market = parseMarket(params.market);
    if (params.symbol !== undefined) {
      const instrument = await this.deps.resolver.resolve(params.symbol, market);
      const alerts = await this.deps.repository.listAlertsForInstrument(instrument.id);
      return {
        market,
        page: 1,
        pageCount: alerts.length,
        hasMore: false,
        alerts: await toAlertViews(this.deps, alerts, market),
      };
    }
    const page = clamp(params.page, 1, 1, 10_000);
    const pageCount = clamp(params.pageCount, 20, 1, 100);
    const alerts = await this.deps.repository.listPriceAlerts(market, { page, pageCount });
    return {
      market,
      page,
      pageCount,
      hasMore: alerts.length === pageCount,
      alerts: await toAlertViews(this.deps, alerts, market),
    };
  }
}
