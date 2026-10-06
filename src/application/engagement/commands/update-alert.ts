import {
  DEFAULT_ALERT_FREQUENCY,
  parseAlertDirection,
  parseAlertFrequency,
} from '../../../domain/engagement/price-alert';
import { parseMarket } from '../../../domain/market-data/market';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { assertNonEmpty, assertPositive } from '../../../domain/shared-kernel/guards';
import { UpstreamError } from '../../errors';
import { marketInput } from '../../inputs';
import { Command, type InputOf } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { directionInput, frequencyInput, idInput, priceInput } from '../inputs';
import { decideDirection, findAlert, placeAlert } from '../price-alerts';
import type { PlacedAlertView } from '../views';

const input = {
  id: idInput,
  price: priceInput.optional(),
  direction: directionInput,
  frequency: frequencyInput,
  market: marketInput,
};

type Output = PlacedAlertView & { previousId: string };

/**
 * IBKR `update_alert`. Thndr has no update endpoint: like ThndrX (docs/api/market-data.md §5.2) we DELETE the
 * alert and POST a new one, so the alert gets a **new id**. Unchanged fields are carried over; when the price
 * changes without an explicit direction, the direction is re-derived from the current price. If re-creation
 * fails, the original alert is restored (best effort) and the error is rethrown.
 */
export class UpdateAlert extends Command<typeof input, Output> {
  readonly name = 'update_alert';
  readonly title = 'Update price alert';
  readonly description =
    "Changes an alert's price, direction or frequency. Thndr has no in-place edit, so the alert is replaced and " +
    'gets a new id (returned together with previousId).';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: EngagementDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const id = assertNonEmpty(params.id, 'Alert id');
    if (params.price !== undefined) assertPositive(params.price, 'Alert price');
    const explicitDirection = parseAlertDirection(params.direction);
    const explicitFrequency = parseAlertFrequency(params.frequency);
    if (params.price === undefined && !explicitDirection && !explicitFrequency) {
      throw new ValidationError('Nothing to change: provide a new price, direction or frequency');
    }
    const market = parseMarket(params.market);
    const existing = await findAlert(this.deps, id, market);
    const price = params.price ?? existing.targetPrice;
    const frequency = explicitFrequency ?? existing.frequency ?? DEFAULT_ALERT_FREQUENCY;
    const priceChanged = price !== existing.targetPrice;
    const direction =
      explicitDirection ??
      (!priceChanged && existing.direction
        ? existing.direction
        : await decideDirection(
            this.deps,
            existing.instrumentId,
            existing.ticker?.value ?? existing.instrumentId.value,
            price,
            market,
          ));

    await this.deps.repository.deletePriceAlert(existing.id);
    try {
      const view = await placeAlert(this.deps, existing.instrumentId, price, direction, frequency, market);
      return { ...view, previousId: existing.id };
    } catch (error) {
      const restored = await this.deps.repository
        .createPriceAlert({
          instrumentId: existing.instrumentId,
          price: existing.targetPrice,
          direction: existing.direction ?? direction,
          frequency: existing.frequency ?? frequency,
          market,
        })
        .then(
          () => true,
          () => false,
        );
      const reason = error instanceof Error ? error.message : String(error);
      throw new UpstreamError(
        `Could not re-create alert ${existing.id} with the new values (${reason}). ` +
          (restored
            ? 'The original alert was restored (with a new id).'
            : 'The original alert could not be restored; re-create it in Thndr.'),
        undefined,
        undefined,
        { cause: error },
      );
    }
  }
}
