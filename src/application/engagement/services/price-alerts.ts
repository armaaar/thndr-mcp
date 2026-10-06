import {
  type AlertDirection,
  type AlertFrequency,
  deriveAlertDirection,
  type PriceAlert,
} from '../../../domain/engagement/price-alert';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import type { Market } from '../../../domain/shared-kernel/market';
import { NotFoundError } from '../../errors';
import { ALERT_SCAN_MAX_PAGES, ALERT_SCAN_PAGE_SIZE } from '../constants';
import type { EngagementDependencies } from '../dependencies';
import type { AlertView, PlacedAlertView } from '../views';
import { InstrumentLabeler } from './instrument-labeler';

/** Alert views enriched with tickers and current prices. */
export async function toAlertViews(
  deps: EngagementDependencies,
  alerts: readonly PriceAlert[],
  market: Market,
): Promise<AlertView[]> {
  const labels = await InstrumentLabeler.for(deps).label(
    alerts.map((a) => a.instrumentId),
    market,
  );
  return alerts.map((alert) => {
    const label = labels.get(alert.instrumentId);
    return {
      id: alert.id,
      instrumentId: alert.instrumentId.value,
      ticker: alert.ticker?.value ?? label.ticker,
      targetPrice: alert.targetPrice,
      direction: alert.direction,
      frequency: alert.frequency,
      createdAt: alert.createdAt?.toISOString() ?? null,
      currentPrice: label.last,
    };
  });
}

/** Finds one alert by id, scanning at most {@link ALERT_SCAN_MAX_PAGES} pages. */
export async function findAlert(
  deps: EngagementDependencies,
  id: string,
  market: Market,
): Promise<PriceAlert> {
  for (let page = 1; page <= ALERT_SCAN_MAX_PAGES; page++) {
    const alerts = await deps.repository.listPriceAlerts(market, { page, pageCount: ALERT_SCAN_PAGE_SIZE });
    const found = alerts.find((a) => a.id === id);
    if (found) return found;
    if (alerts.length < ALERT_SCAN_PAGE_SIZE) break;
  }
  throw new NotFoundError(`No ${market} price alert with id ${id}. Use get_alerts to list them.`);
}

/** Places an alert and returns its view; falls back to the per-asset list when Thndr's reply is opaque. */
export async function placeAlert(
  deps: EngagementDependencies,
  instrumentId: AssetId,
  price: number,
  direction: AlertDirection,
  frequency: AlertFrequency,
  market: Market,
): Promise<PlacedAlertView> {
  let created = await deps.repository.createPriceAlert({ instrumentId, price, direction, frequency, market });
  if (!created) {
    const existing = await deps.repository
      .listAlertsForInstrument(instrumentId)
      .catch(() => [] as PriceAlert[]);
    created =
      existing.find(
        (a) =>
          a.targetPrice === price &&
          (a.direction === null || a.direction === direction) &&
          (a.frequency === null || a.frequency === frequency),
      ) ?? null;
  }
  if (created) {
    const [view] = await toAlertViews(deps, [created], market);
    return view as AlertView;
  }
  const label = (await InstrumentLabeler.for(deps).label([instrumentId], market)).get(instrumentId);
  return {
    id: null,
    instrumentId: instrumentId.value,
    ticker: label.ticker,
    targetPrice: price,
    direction,
    frequency,
    createdAt: null,
    currentPrice: label.last,
  };
}

/** ThndrX's rule: `DOWN` when the target is below the current price, else `UP`. Fails without a current price. */
export async function decideDirection(
  deps: EngagementDependencies,
  instrumentId: AssetId,
  ticker: string,
  price: number,
  market: Market,
): Promise<AlertDirection> {
  const current = await InstrumentLabeler.for(deps).currentPrice(instrumentId, market);
  if (current === null || current <= 0) {
    throw new ValidationError(
      `No current price for ${ticker}, so the alert direction cannot be derived. Pass direction UP or DOWN.`,
    );
  }
  return deriveAlertDirection(price, current);
}
