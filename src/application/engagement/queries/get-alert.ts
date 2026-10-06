import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { idInput } from '../inputs';
import { findAlert, toAlertViews } from '../services/price-alerts';
import type { AlertView } from '../views';

const input = { id: idInput, market: marketInput };

/** IBKR `get_alert`: finds one alert by id, scanning at most ALERT_SCAN_MAX_PAGES pages. */
export class GetAlert extends Query<typeof input, AlertView> {
  readonly name = 'get_alert';
  readonly title = 'Price alert';
  readonly description = 'One price alert by id.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<AlertView> {
    const id = assertNonEmpty(params.id, 'Alert id');
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'priceAlerts');
    const alert = await findAlert(this.deps, id, market);
    const [view] = await toAlertViews(this.deps, [alert], market);
    return view as AlertView;
  }
}
