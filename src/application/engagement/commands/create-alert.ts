import {
  DEFAULT_ALERT_FREQUENCY,
  parseAlertDirection,
  parseAlertFrequency,
} from '../../../domain/engagement/price-alert';
import { assertPositive } from '../../../domain/shared-kernel/guards';
import { parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { requireMarketFeature } from '../../market-features';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { directionInput, frequencyInput, priceInput } from '../inputs';
import { decideDirection, placeAlert } from '../services/price-alerts';
import { type AlertReceipt, toAlertReceipt } from '../views';

const input = {
  symbol: symbolInput,
  price: priceInput,
  direction: directionInput,
  frequency: frequencyInput,
  market: marketInput,
};

/**
 * IBKR `create_alert`: a price alert on a symbol. The direction defaults to ThndrX's rule — `DOWN` when the
 * target is below the last price, else `UP` — and the frequency to `ONE_TIME`.
 */
export class CreateAlert extends Command<typeof input, AlertReceipt> {
  readonly name = 'create_alert';
  readonly title = 'Create price alert';
  readonly description =
    'Creates a price alert that notifies the user in the Thndr app when the instrument crosses `price`. ' +
    'Direction is inferred from the current price unless given; in the US give it explicitly, because Thndr has ' +
    'no whole-market snapshot there to read the current price from.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<AlertReceipt> {
    assertPositive(params.price, 'Alert price');
    const explicitDirection = parseAlertDirection(params.direction);
    const frequency = parseAlertFrequency(params.frequency) ?? DEFAULT_ALERT_FREQUENCY;
    const market = parseMarket(params.market);
    requireMarketFeature(market, 'priceAlerts');
    const instrument = await this.deps.resolver.resolve(params.symbol, market);
    const direction =
      explicitDirection ??
      (await decideDirection(this.deps, instrument.id, instrument.ticker.value, params.price, market));
    return toAlertReceipt(
      await placeAlert(this.deps, instrument.id, params.price, direction, frequency, market),
    );
  }
}
