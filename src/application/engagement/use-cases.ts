import type { Notification } from '../../domain/engagement/notification.js';
import {
  type AlertDirection,
  type AlertFrequency,
  DEFAULT_ALERT_FREQUENCY,
  deriveAlertDirection,
  type PriceAlert,
  parseAlertDirection,
  parseAlertFrequency,
} from '../../domain/engagement/price-alert.js';
import { uniqueAssetIds, type Watchlist, WatchlistName } from '../../domain/engagement/watchlist.js';
import type { AssetId } from '../../domain/market-data/asset-id.js';
import { type Market, parseMarket } from '../../domain/market-data/market.js';
import { ValidationError } from '../../domain/shared/errors.js';
import { assertNonEmpty, assertPositive } from '../../domain/shared/guards.js';
import { NotFoundError, UpstreamError } from '../errors.js';
import type { InstrumentResolver } from '../market-data/instrument-resolver.js';
import type { MarketQuotesCache } from '../market-data/quote-cache.js';
import type { EngagementGateway } from '../ports/engagement.js';
import {
  assetIdOrNull,
  type InstrumentLabel,
  InstrumentLabeler,
  type InstrumentLabels,
} from './instrument-labels.js';

export interface EngagementDependencies {
  gateway: EngagementGateway;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
}

/** Most symbols accepted in one watchlist call (create or edit). */
export const MAX_SYMBOLS_PER_CALL = 100;

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(Math.max(n, min), max);
}

function labeler(deps: EngagementDependencies): InstrumentLabeler {
  return new InstrumentLabeler(deps.resolver, deps.quotes);
}

function checkSymbolCount(symbols: readonly string[] | undefined, label: string): readonly string[] {
  const list = symbols ?? [];
  if (list.length > MAX_SYMBOLS_PER_CALL) {
    throw new ValidationError(`At most ${MAX_SYMBOLS_PER_CALL} symbols in "${label}"`);
  }
  return list;
}

async function resolveIds(
  deps: EngagementDependencies,
  symbols: readonly string[],
  market: Market,
): Promise<AssetId[]> {
  const instruments = await deps.resolver.resolveMany(symbols, market);
  return uniqueAssetIds(instruments.map((i) => i.id));
}

// ---------------------------------------------------------------- watchlists

export interface WatchlistSummaryView {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  count: number;
  instruments: Array<{ instrumentId: string; ticker: string | null }>;
}

export interface WatchlistView extends Omit<WatchlistSummaryView, 'instruments'> {
  market: Market;
  instruments: InstrumentLabel[];
}

function toWatchlistView(watchlist: Watchlist, labels: InstrumentLabels, market: Market): WatchlistView {
  return {
    ...toSummaryView(watchlist, labels),
    market,
    instruments: watchlist.instrumentIds.map((id) => labels.get(id)),
  };
}

function toSummaryView(watchlist: Watchlist, labels: InstrumentLabels): WatchlistSummaryView {
  return {
    id: watchlist.id,
    name: watchlist.name,
    color: watchlist.color,
    icon: watchlist.icon,
    count: watchlist.instrumentIds.length,
    instruments: watchlist.instrumentIds.map((id) => ({
      instrumentId: id.value,
      ticker: labels.get(id).ticker,
    })),
  };
}

/** IBKR `get_watchlists`: every custom watchlist of a market with its tickers. */
export class GetWatchlists {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(
    input: { market?: string } = {},
  ): Promise<{ market: Market; watchlists: WatchlistSummaryView[] }> {
    const market = parseMarket(input.market);
    const watchlists = await this.deps.gateway.listWatchlists(market);
    const labels = await labeler(this.deps).label(
      watchlists.flatMap((w) => w.instrumentIds),
      market,
    );
    return {
      market,
      watchlists: watchlists.map((w) => toSummaryView(w, labels)),
    };
  }
}

/** IBKR `get_watchlist`: one watchlist with tickers, names and live prices. */
export class GetWatchlist {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: { id: string; market?: string }): Promise<WatchlistView> {
    const id = assertNonEmpty(input.id, 'Watchlist id');
    const market = parseMarket(input.market);
    let watchlist = await this.deps.gateway.getWatchlist(id);
    if (watchlist.name === '') {
      // The detail endpoint only returns `asset_ids`: borrow the name/colour/icon from the list.
      const summaries = await this.deps.gateway.listWatchlists(market).catch(() => [] as Watchlist[]);
      const summary = summaries.find((w) => w.id === watchlist.id);
      if (summary) watchlist = { ...summary, instrumentIds: watchlist.instrumentIds };
    }
    const labels = await labeler(this.deps).label(watchlist.instrumentIds, market);
    return toWatchlistView(watchlist, labels, market);
  }
}

/** IBKR `create_watchlist`: creates a named watchlist, optionally seeded with symbols. */
export class CreateWatchlist {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: {
    name: string;
    symbols?: readonly string[];
    market?: string;
  }): Promise<WatchlistView> {
    const name = WatchlistName.of(input.name);
    const market = parseMarket(input.market);
    const ids = await resolveIds(this.deps, checkSymbolCount(input.symbols, 'symbols'), market);
    const created = await this.deps.gateway.createWatchlist(name, market, ids);
    const labels = await labeler(this.deps).label(created.instrumentIds, market);
    return toWatchlistView(created, labels, market);
  }
}

/**
 * IBKR `edit_watchlist`: rename and/or add and remove instruments in one call. Changes are applied in that order;
 * the watchlist is re-read afterwards. Removals accept tickers or raw asset ids (ids of delisted instruments
 * are removed without a lookup).
 */
export class EditWatchlist {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: {
    id: string;
    name?: string;
    add?: readonly string[];
    remove?: readonly string[];
    market?: string;
  }): Promise<WatchlistView & { changes: { renamed: boolean; added: string[]; removed: string[] } }> {
    const id = assertNonEmpty(input.id, 'Watchlist id');
    const market = parseMarket(input.market);
    const name = input.name === undefined ? null : WatchlistName.of(input.name);
    const addSymbols = checkSymbolCount(input.add, 'add');
    const removeSymbols = checkSymbolCount(input.remove, 'remove');
    if (!name && addSymbols.length === 0 && removeSymbols.length === 0) {
      throw new ValidationError('Nothing to change: provide a new name, symbols to add or symbols to remove');
    }
    const [add, remove] = await Promise.all([
      resolveIds(this.deps, addSymbols, market),
      Promise.all(
        removeSymbols.map(async (s) => assetIdOrNull(s) ?? (await this.deps.resolver.resolve(s, market)).id),
      ).then(uniqueAssetIds),
    ]);
    const conflict = add.find((a) => remove.some((r) => r.equals(a)));
    if (conflict) {
      throw new ValidationError(`Instrument ${conflict.value} is both added and removed; pick one`);
    }
    if (name) await this.deps.gateway.renameWatchlist(id, name);
    if (add.length > 0) await this.deps.gateway.addToWatchlist(id, add);
    if (remove.length > 0) await this.deps.gateway.removeFromWatchlist(id, remove);
    const view = await new GetWatchlist(this.deps).execute({ id, market });
    return {
      ...(name ? { ...view, name: name.value } : view),
      changes: {
        renamed: name !== null,
        added: add.map((a) => a.value),
        removed: remove.map((r) => r.value),
      },
    };
  }
}

/** IBKR `delete_watchlist`. */
export class DeleteWatchlist {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: { id: string }): Promise<{ id: string; deleted: true }> {
    const id = assertNonEmpty(input.id, 'Watchlist id');
    await this.deps.gateway.deleteWatchlist(id);
    return { id, deleted: true };
  }
}

// ---------------------------------------------------------------- price alerts

export interface AlertView {
  id: string;
  instrumentId: string;
  ticker: string | null;
  targetPrice: number;
  direction: AlertDirection | null;
  frequency: AlertFrequency | null;
  createdAt: string | null;
  /** Last traded price, when the market snapshot has it. */
  currentPrice: number | null;
}

async function toAlertViews(
  deps: EngagementDependencies,
  alerts: readonly PriceAlert[],
  market: Market,
): Promise<AlertView[]> {
  const labels = await labeler(deps).label(
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

/** An alert just placed: `id` is null when Thndr's reply did not identify it and no match was found. */
export type PlacedAlertView = Omit<AlertView, 'id'> & { id: string | null };

/** Page size used when scanning every alert (GetAlert, UpdateAlert). */
export const ALERT_SCAN_PAGE_SIZE = 50;
/** Most pages scanned when looking an alert up by id (500 alerts). */
export const ALERT_SCAN_MAX_PAGES = 10;

async function findAlert(deps: EngagementDependencies, id: string, market: Market): Promise<PriceAlert> {
  for (let page = 1; page <= ALERT_SCAN_MAX_PAGES; page++) {
    const alerts = await deps.gateway.listPriceAlerts(market, { page, pageCount: ALERT_SCAN_PAGE_SIZE });
    const found = alerts.find((a) => a.id === id);
    if (found) return found;
    if (alerts.length < ALERT_SCAN_PAGE_SIZE) break;
  }
  throw new NotFoundError(`No ${market} price alert with id ${id}. Use get_alerts to list them.`);
}

/** IBKR `get_alerts`: one page of the market's alerts, or every alert of one symbol. */
export class GetAlerts {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(
    input: { market?: string; symbol?: string; page?: number; pageCount?: number } = {},
  ): Promise<{
    market: Market;
    page: number;
    pageCount: number;
    hasMore: boolean;
    alerts: AlertView[];
  }> {
    const market = parseMarket(input.market);
    if (input.symbol !== undefined) {
      const instrument = await this.deps.resolver.resolve(input.symbol, market);
      const alerts = await this.deps.gateway.listAlertsForInstrument(instrument.id);
      return {
        market,
        page: 1,
        pageCount: alerts.length,
        hasMore: false,
        alerts: await toAlertViews(this.deps, alerts, market),
      };
    }
    const page = clamp(input.page, 1, 1, 10_000);
    const pageCount = clamp(input.pageCount, 20, 1, 100);
    const alerts = await this.deps.gateway.listPriceAlerts(market, { page, pageCount });
    return {
      market,
      page,
      pageCount,
      hasMore: alerts.length === pageCount,
      alerts: await toAlertViews(this.deps, alerts, market),
    };
  }
}

/** IBKR `get_alert`: finds one alert by id, scanning at most {@link ALERT_SCAN_MAX_PAGES} pages. */
export class GetAlert {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: { id: string; market?: string }): Promise<AlertView> {
    const id = assertNonEmpty(input.id, 'Alert id');
    const market = parseMarket(input.market);
    const alert = await findAlert(this.deps, id, market);
    const [view] = await toAlertViews(this.deps, [alert], market);
    return view as AlertView;
  }
}

/** Places an alert and returns its view; falls back to the per-asset list when Thndr's reply is opaque. */
async function placeAlert(
  deps: EngagementDependencies,
  instrumentId: AssetId,
  price: number,
  direction: AlertDirection,
  frequency: AlertFrequency,
  market: Market,
): Promise<PlacedAlertView> {
  let created = await deps.gateway.createPriceAlert({ instrumentId, price, direction, frequency, market });
  if (!created) {
    const existing = await deps.gateway.listAlertsForInstrument(instrumentId).catch(() => [] as PriceAlert[]);
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
  const label = (await labeler(deps).label([instrumentId], market)).get(instrumentId);
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

async function decideDirection(
  deps: EngagementDependencies,
  instrumentId: AssetId,
  ticker: string,
  price: number,
  market: Market,
): Promise<AlertDirection> {
  const current = await labeler(deps).currentPrice(instrumentId, market);
  if (current === null || current <= 0) {
    throw new ValidationError(
      `No current price for ${ticker}, so the alert direction cannot be derived. Pass direction UP or DOWN.`,
    );
  }
  return deriveAlertDirection(price, current);
}

/**
 * IBKR `create_alert`: a price alert on a symbol. The direction defaults to ThndrX's rule — `DOWN` when the
 * target is below the last price, else `UP` — and the frequency to `ONE_TIME`.
 */
export class CreateAlert {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: {
    symbol: string;
    price: number;
    direction?: string;
    frequency?: string;
    market?: string;
  }): Promise<PlacedAlertView> {
    assertPositive(input.price, 'Alert price');
    const explicitDirection = parseAlertDirection(input.direction);
    const frequency = parseAlertFrequency(input.frequency) ?? DEFAULT_ALERT_FREQUENCY;
    const market = parseMarket(input.market);
    const instrument = await this.deps.resolver.resolve(input.symbol, market);
    const direction =
      explicitDirection ??
      (await decideDirection(this.deps, instrument.id, instrument.ticker.value, input.price, market));
    return placeAlert(this.deps, instrument.id, input.price, direction, frequency, market);
  }
}

/**
 * IBKR `update_alert`. Thndr has no update endpoint: like ThndrX (docs/api/market-data.md §5.2) we DELETE the
 * alert and POST a new one, so the alert gets a **new id**. Unchanged fields are carried over; when the price
 * changes without an explicit direction, the direction is re-derived from the current price. If re-creation
 * fails, the original alert is restored (best effort) and the error is rethrown.
 */
export class UpdateAlert {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: {
    id: string;
    price?: number;
    direction?: string;
    frequency?: string;
    market?: string;
  }): Promise<PlacedAlertView & { previousId: string }> {
    const id = assertNonEmpty(input.id, 'Alert id');
    if (input.price !== undefined) assertPositive(input.price, 'Alert price');
    const explicitDirection = parseAlertDirection(input.direction);
    const explicitFrequency = parseAlertFrequency(input.frequency);
    if (input.price === undefined && !explicitDirection && !explicitFrequency) {
      throw new ValidationError('Nothing to change: provide a new price, direction or frequency');
    }
    const market = parseMarket(input.market);
    const existing = await findAlert(this.deps, id, market);
    const price = input.price ?? existing.targetPrice;
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

    await this.deps.gateway.deletePriceAlert(existing.id);
    try {
      const view = await placeAlert(this.deps, existing.instrumentId, price, direction, frequency, market);
      return { ...view, previousId: existing.id };
    } catch (error) {
      const restored = await this.deps.gateway
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

/** IBKR `delete_alert`. Idempotent. */
export class DeleteAlert {
  constructor(private readonly deps: EngagementDependencies) {}

  async execute(input: { id: string }): Promise<{ id: string; deleted: true }> {
    const id = assertNonEmpty(input.id, 'Alert id');
    await this.deps.gateway.deletePriceAlert(id);
    return { id, deleted: true };
  }
}

// ---------------------------------------------------------------- notifications

export interface NotificationView {
  id: string;
  title: string;
  text: string;
  read: boolean;
  createdAt: string | null;
  type: string | null;
}

function toNotificationView(n: Notification): NotificationView {
  return {
    id: n.id,
    title: n.title,
    text: n.text,
    read: n.read,
    createdAt: n.createdAt?.toISOString() ?? null,
    type: n.type,
  };
}

/** One page of in-app notifications plus the global "has unread" flag. */
export class GetNotifications {
  constructor(private readonly deps: Pick<EngagementDependencies, 'gateway'>) {}

  async execute(input: { page?: number; pageCount?: number; unreadOnly?: boolean } = {}): Promise<{
    page: number;
    pageCount: number;
    hasMore: boolean;
    hasUnread: boolean;
    notifications: NotificationView[];
  }> {
    const page = clamp(input.page, 1, 1, 10_000);
    const pageCount = clamp(input.pageCount, 20, 1, 100);
    const [notifications, hasUnread] = await Promise.all([
      this.deps.gateway.listNotifications(page, pageCount),
      this.deps.gateway.hasUnreadNotifications(),
    ]);
    return {
      page,
      pageCount,
      hasMore: notifications.length === pageCount,
      hasUnread,
      notifications: notifications.filter((n) => !input.unreadOnly || !n.read).map(toNotificationView),
    };
  }
}

/** Marks the given notifications — or all of them — as read. */
export class MarkNotificationsRead {
  constructor(private readonly deps: Pick<EngagementDependencies, 'gateway'>) {}

  async execute(input: { ids?: readonly string[]; all?: boolean }): Promise<{ all: boolean; ids: string[] }> {
    const ids = [...new Set((input.ids ?? []).map((id) => assertNonEmpty(id, 'Notification id')))];
    if (input.all === true) {
      if (ids.length > 0) throw new ValidationError('Pass either ids or all=true, not both');
      await this.deps.gateway.markAllNotificationsRead();
      return { all: true, ids: [] };
    }
    if (ids.length === 0) throw new ValidationError('Provide notification ids, or all=true');
    if (ids.length > 200) throw new ValidationError('At most 200 notification ids per call');
    await this.deps.gateway.markNotificationsRead(ids);
    return { all: false, ids };
  }
}
