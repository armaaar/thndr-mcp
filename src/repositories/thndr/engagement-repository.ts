import { UpstreamError } from '../../application/errors';
import type {
  CreatePriceAlertBodyDto,
  CreateWatchlistBodyDto,
  HasUnreadDto,
  NotificationBatchBodyDto,
  NotificationDto,
  PriceAlertDto,
  PriceAlertsPageDto,
  WatchAssetsBodyDto,
  WatchlistDto,
  WatchlistsResponseDto,
} from '../../data-sources/thndr/dto/engagement';
import type { ThndrHttpClient } from '../../data-sources/thndr/http-client';
import { assertNoKrakendError } from '../../data-sources/thndr/krakend';
import type { Notification } from '../../domain/engagement/notification';
import type { PriceAlert } from '../../domain/engagement/price-alert';
import type { EngagementRepository, NewPriceAlert, PageRequest } from '../../domain/engagement/repository';
import type { Watchlist, WatchlistName } from '../../domain/engagement/watchlist';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import { accountMarket } from './markets';
import { toNotification, toPriceAlert, toWatchlist } from './translators/engagement';
import { mapRows } from './translators/market-data';

const WATCHLISTS = '/users-service/watchlists';
const ALERTS = '/price-alerts/v1/alerts';
const NOTIFICATIONS = '/notifications/v1';
/** ThndrX fetches the per-asset alerts with `page=1&page_count=5` (§5.2). */
const ASSET_ALERTS_PAGE = { page: 1, page_count: 5 } as const;

function seg(value: string): string {
  return encodeURIComponent(value);
}

function ids(instrumentIds: readonly AssetId[]): string[] {
  return instrumentIds.map((id) => id.value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof UpstreamError && error.status === 404;
}

/**
 * Adapter for Thndr's engagement endpoints. `api` targets https://prod.thndr.app (watchlists, §4.1); `krakend`
 * targets https://prod.thndr.app/krakend-thndr-x (price alerts §5.2, notifications misc §5) and every krakend
 * response goes through {@link assertNoKrakendError}.
 */
export class ThndrEngagementRepository implements EngagementRepository {
  constructor(
    private readonly api: ThndrHttpClient,
    private readonly krakend: ThndrHttpClient,
  ) {}

  // ------------------------------------------------------------ watchlists (§4.1)

  async listWatchlists(market: Market): Promise<Watchlist[]> {
    const data = await this.api.get<WatchlistsResponseDto>(WATCHLISTS, {
      query: { market: accountMarket(market) },
    });
    return mapRows(data?.watchlists, toWatchlist);
  }

  async getWatchlist(id: string): Promise<Watchlist> {
    const data = await this.api.get<WatchlistDto>(`${WATCHLISTS}/${seg(id)}`);
    // The detail payload is `{ asset_ids }`: fall back to the requested id.
    const watchlist = toWatchlist(data && typeof data === 'object' ? { ...data, id: data.id ?? id } : null);
    if (!watchlist) throw new UpstreamError(`Unexpected watchlist payload from Thndr for ${id}`);
    return watchlist;
  }

  async createWatchlist(
    name: WatchlistName,
    market: Market,
    instrumentIds: readonly AssetId[],
  ): Promise<Watchlist> {
    const body: CreateWatchlistBodyDto = {
      name: name.value,
      market: accountMarket(market),
      source: 'thndrx',
      asset_ids: ids(instrumentIds),
    };
    const data = await this.api.post<WatchlistDto>(WATCHLISTS, body);
    // The response contains at least `{ id }`; complete it with what we sent.
    const watchlist = toWatchlist(
      data && typeof data === 'object'
        ? { ...data, name: data.name ?? body.name, asset_ids: data.asset_ids ?? body.asset_ids }
        : null,
    );
    if (!watchlist) throw new UpstreamError('Thndr did not return the id of the created watchlist');
    return watchlist;
  }

  async renameWatchlist(id: string, name: WatchlistName): Promise<void> {
    await this.api.patch(`${WATCHLISTS}/${seg(id)}`, { name: name.value });
  }

  async deleteWatchlist(id: string): Promise<void> {
    await this.api.delete(`${WATCHLISTS}/${seg(id)}`);
  }

  async addToWatchlist(id: string, instrumentIds: readonly AssetId[]): Promise<void> {
    const body: WatchAssetsBodyDto = { asset_ids: ids(instrumentIds) };
    await this.api.post(`${WATCHLISTS}/${seg(id)}/watch-assets`, body);
  }

  async removeFromWatchlist(id: string, instrumentIds: readonly AssetId[]): Promise<void> {
    const body: WatchAssetsBodyDto = { asset_ids: ids(instrumentIds) };
    await this.api.post(`${WATCHLISTS}/${seg(id)}/unwatch-assets`, body);
  }

  // ------------------------------------------------------------ price alerts (§5.2, krakend)

  async listPriceAlerts(market: Market, page: PageRequest): Promise<PriceAlert[]> {
    const data = await this.krakend.get<PriceAlertsPageDto>(ALERTS, {
      query: { page: page.page, page_count: page.pageCount, market: accountMarket(market) },
    });
    assertNoKrakendError(data, `GET ${ALERTS}`);
    return mapRows(data?.results, toPriceAlert);
  }

  async listAlertsForInstrument(instrumentId: AssetId): Promise<PriceAlert[]> {
    const path = `/price-alerts/v1/asset-alerts/${seg(instrumentId.value)}`;
    const data = await this.krakend.get<PriceAlertsPageDto>(path, { query: { ...ASSET_ALERTS_PAGE } });
    assertNoKrakendError(data, `GET ${path}`);
    return mapRows(data?.results, toPriceAlert);
  }

  async createPriceAlert(alert: NewPriceAlert): Promise<PriceAlert | null> {
    const body: CreatePriceAlertBodyDto = {
      asset_id: alert.instrumentId.value,
      price: alert.price,
      frequency: alert.frequency,
      direction: alert.direction,
      market: accountMarket(alert.market),
    };
    const data = await this.krakend.post<PriceAlertDto | null>(ALERTS, body);
    assertNoKrakendError(data, `POST ${ALERTS}`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    // The response shape is not confirmed: complete it with what we sent.
    return toPriceAlert({
      ...data,
      asset_id: data.asset_id ?? body.asset_id,
      price: data.price ?? body.price,
      frequency: data.frequency ?? body.frequency,
      direction: data.direction ?? body.direction,
    });
  }

  async deletePriceAlert(id: string): Promise<void> {
    const path = `${ALERTS}/${seg(id)}`;
    try {
      const data = await this.krakend.delete<unknown>(path);
      assertNoKrakendError(data, `DELETE ${path}`);
    } catch (error) {
      // ThndrX swallows 404s: the alert is already gone (e.g. a one-time alert that fired).
      if (!isNotFound(error)) throw error;
    }
  }

  // ------------------------------------------------------------ notifications (misc §5, krakend)

  async listNotifications(page: number, pageCount: number): Promise<Notification[]> {
    const data = await this.krakend.get<NotificationDto[] | { collection?: NotificationDto[] }>(
      NOTIFICATIONS,
      {
        query: { page, page_count: pageCount },
      },
    );
    assertNoKrakendError(data, `GET ${NOTIFICATIONS}`);
    // A bare array per ThndrX; krakend wraps arrays in `collection` when not configured as a collection.
    const rows = Array.isArray(data) ? data : data?.collection;
    return mapRows(rows, toNotification);
  }

  async hasUnreadNotifications(): Promise<boolean> {
    const path = `${NOTIFICATIONS}/has-unread`;
    const data = await this.krakend.get<HasUnreadDto>(path);
    assertNoKrakendError(data, `GET ${path}`);
    return data?.has_unread === true;
  }

  async markNotificationsRead(notificationIds: readonly string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    const path = `${NOTIFICATIONS}/batch`;
    const body: NotificationBatchBodyDto = notificationIds.map((id) => ({ id }));
    const data = await this.krakend.patch<unknown>(path, body, { query: { field: 'is_read' } });
    assertNoKrakendError(data, `PATCH ${path}`);
  }

  async markAllNotificationsRead(): Promise<void> {
    const path = `${NOTIFICATIONS}/read-all`;
    const data = await this.krakend.patch<unknown>(path);
    assertNoKrakendError(data, `PATCH ${path}`);
  }
}
