import type { Notification } from '../../domain/engagement/notification';
import type { AlertDirection, AlertFrequency } from '../../domain/engagement/price-alert';
import type { Watchlist } from '../../domain/engagement/watchlist';
import type { Market } from '../../domain/market-data/market';
import type { InstrumentLabel, InstrumentLabels } from './services/instrument-labels';

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

/** An alert just placed: `id` is null when Thndr's reply did not identify it and no match was found. */
export type PlacedAlertView = Omit<AlertView, 'id'> & { id: string | null };

export interface NotificationView {
  id: string;
  title: string;
  text: string;
  read: boolean;
  createdAt: string | null;
  type: string | null;
}

export function toSummaryView(watchlist: Watchlist, labels: InstrumentLabels): WatchlistSummaryView {
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

export function toWatchlistView(
  watchlist: Watchlist,
  labels: InstrumentLabels,
  market: Market,
): WatchlistView {
  return {
    ...toSummaryView(watchlist, labels),
    market,
    instruments: watchlist.instrumentIds.map((id) => labels.get(id)),
  };
}

export function toNotificationView(n: Notification): NotificationView {
  return {
    id: n.id,
    title: n.title,
    text: n.text,
    read: n.read,
    createdAt: n.createdAt?.toISOString() ?? null,
    type: n.type,
  };
}
