import type { EngagementDependencies } from '../../src/application/engagement/dependencies';
import { InstrumentResolver } from '../../src/application/market-data/services/instrument-resolver';
import { MarketQuotesCache } from '../../src/application/market-data/services/market-quotes-cache';
import { createNotification, type Notification } from '../../src/domain/engagement/notification';
import { createPriceAlert, type PriceAlert } from '../../src/domain/engagement/price-alert';
import type {
  EngagementRepository,
  NewPriceAlert,
  PageRequest,
} from '../../src/domain/engagement/repository';
import { createWatchlist, type Watchlist, type WatchlistName } from '../../src/domain/engagement/watchlist';
import { AssetId } from '../../src/domain/market-data/asset-id';
import type { Market } from '../../src/domain/market-data/market';
import { Ticker } from '../../src/domain/shared-kernel/ticker';
import { anInstrument, aQuote, FakeMarketDataRepository, fixedClock, idFor } from './fake-market-data';

type WatchlistOverrides = Partial<Omit<Watchlist, 'instrumentIds'>> & { tickers?: string[]; ids?: string[] };

export function aWatchlist(overrides: WatchlistOverrides = {}): Watchlist {
  const { tickers = ['COMI'], ids, ...rest } = overrides;
  return createWatchlist({
    id: 'wl-1',
    name: 'Banks',
    color: 'color_4',
    icon: 'thndr',
    instrumentIds: (ids ?? tickers.map(idFor)).map((id) => AssetId.of(id)),
    ...rest,
  });
}

type AlertOverrides = Partial<Omit<PriceAlert, 'instrumentId' | 'ticker'>> & {
  ticker?: string | null;
  instrumentId?: string;
};

export function anAlert(overrides: AlertOverrides = {}): PriceAlert {
  const { ticker = 'COMI', instrumentId, ...rest } = overrides;
  return createPriceAlert({
    id: 'a-1',
    instrumentId: AssetId.of(instrumentId ?? idFor(ticker ?? 'COMI')),
    ticker: ticker === null ? null : Ticker.of(ticker),
    targetPrice: 110,
    direction: 'UP',
    frequency: 'ONE_TIME',
    createdAt: new Date('2026-01-01T09:00:00Z'),
    ...rest,
  });
}

export function aNotification(overrides: Partial<Notification> = {}): Notification {
  return createNotification({
    id: 'n-1',
    title: 'Order completed',
    text: 'Your order for COMI was executed',
    read: false,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    type: 'order_completed',
    ...overrides,
  });
}

/** In-memory EngagementRepository with recorded calls and per-method failures. */
export class FakeEngagementRepository implements EngagementRepository {
  watchlists: Watchlist[] = [];
  /** Per-market alerts; `listPriceAlerts` pages through them. */
  alerts: PriceAlert[] = [];
  notifications: Notification[] = [];
  hasUnread = false;
  /** When false, `createPriceAlert` returns null (opaque upstream reply). */
  createReturnsAlert = true;
  /** When set, the named method rejects with this error. */
  failures: Partial<Record<keyof EngagementRepository, Error>> = {};
  /** Fails only the n-th (1-based) call of a method. */
  failOnCall: Partial<Record<keyof EngagementRepository, { call: number; error: Error }>> = {};
  private nextId = 100;

  readonly calls = {
    listWatchlists: [] as Market[],
    getWatchlist: [] as string[],
    createWatchlist: [] as Array<{ name: string; market: Market; ids: string[] }>,
    renameWatchlist: [] as Array<{ id: string; name: string }>,
    deleteWatchlist: [] as string[],
    addToWatchlist: [] as Array<{ id: string; ids: string[] }>,
    removeFromWatchlist: [] as Array<{ id: string; ids: string[] }>,
    listPriceAlerts: [] as Array<{ market: Market } & PageRequest>,
    listAlertsForInstrument: [] as string[],
    createPriceAlert: [] as Array<Omit<NewPriceAlert, 'instrumentId'> & { instrumentId: string }>,
    deletePriceAlert: [] as string[],
    listNotifications: [] as Array<{ page: number; pageCount: number }>,
    hasUnreadNotifications: 0,
    markNotificationsRead: [] as string[][],
    markAllNotificationsRead: 0,
  };

  constructor(seed: Partial<Pick<FakeEngagementRepository, 'watchlists' | 'alerts' | 'notifications'>> = {}) {
    Object.assign(this, seed);
  }

  async listWatchlists(market: Market): Promise<Watchlist[]> {
    this.calls.listWatchlists.push(market);
    this.fail('listWatchlists', this.calls.listWatchlists.length);
    return this.watchlists;
  }

  async getWatchlist(id: string): Promise<Watchlist> {
    this.calls.getWatchlist.push(id);
    this.fail('getWatchlist', this.calls.getWatchlist.length);
    const found = this.watchlists.find((w) => w.id === id);
    if (!found) throw new Error(`fake: no watchlist ${id}`);
    // Like Thndr's detail endpoint: only the asset ids.
    return createWatchlist({ id, name: '', instrumentIds: found.instrumentIds });
  }

  async createWatchlist(name: WatchlistName, market: Market, ids: readonly AssetId[]): Promise<Watchlist> {
    this.calls.createWatchlist.push({ name: name.value, market, ids: ids.map((i) => i.value) });
    this.fail('createWatchlist', this.calls.createWatchlist.length);
    const created = createWatchlist({ id: `wl-${this.nextId++}`, name: name.value, instrumentIds: ids });
    this.watchlists.push(created);
    return created;
  }

  async renameWatchlist(id: string, name: WatchlistName): Promise<void> {
    this.calls.renameWatchlist.push({ id, name: name.value });
    this.fail('renameWatchlist', this.calls.renameWatchlist.length);
    this.update(id, (w) => ({ ...w, name: name.value }));
  }

  async deleteWatchlist(id: string): Promise<void> {
    this.calls.deleteWatchlist.push(id);
    this.fail('deleteWatchlist', this.calls.deleteWatchlist.length);
    this.watchlists = this.watchlists.filter((w) => w.id !== id);
  }

  async addToWatchlist(id: string, ids: readonly AssetId[]): Promise<void> {
    this.calls.addToWatchlist.push({ id, ids: ids.map((i) => i.value) });
    this.fail('addToWatchlist', this.calls.addToWatchlist.length);
    this.update(id, (w) => ({ ...w, instrumentIds: [...w.instrumentIds, ...ids] }));
  }

  async removeFromWatchlist(id: string, ids: readonly AssetId[]): Promise<void> {
    this.calls.removeFromWatchlist.push({ id, ids: ids.map((i) => i.value) });
    this.fail('removeFromWatchlist', this.calls.removeFromWatchlist.length);
    this.update(id, (w) => ({
      ...w,
      instrumentIds: w.instrumentIds.filter((x) => !ids.some((r) => r.equals(x))),
    }));
  }

  async listPriceAlerts(market: Market, page: PageRequest): Promise<PriceAlert[]> {
    this.calls.listPriceAlerts.push({ market, ...page });
    this.fail('listPriceAlerts', this.calls.listPriceAlerts.length);
    const start = (page.page - 1) * page.pageCount;
    return this.alerts.slice(start, start + page.pageCount);
  }

  async listAlertsForInstrument(instrumentId: AssetId): Promise<PriceAlert[]> {
    this.calls.listAlertsForInstrument.push(instrumentId.value);
    this.fail('listAlertsForInstrument', this.calls.listAlertsForInstrument.length);
    return this.alerts.filter((a) => a.instrumentId.equals(instrumentId));
  }

  async createPriceAlert(alert: NewPriceAlert): Promise<PriceAlert | null> {
    this.calls.createPriceAlert.push({ ...alert, instrumentId: alert.instrumentId.value });
    this.fail('createPriceAlert', this.calls.createPriceAlert.length);
    const created = createPriceAlert({
      id: `a-${this.nextId++}`,
      instrumentId: alert.instrumentId,
      targetPrice: alert.price,
      direction: alert.direction,
      frequency: alert.frequency,
      createdAt: new Date('2026-01-15T12:00:00Z'),
    });
    this.alerts.push(created);
    return this.createReturnsAlert ? created : null;
  }

  async deletePriceAlert(id: string): Promise<void> {
    this.calls.deletePriceAlert.push(id);
    this.fail('deletePriceAlert', this.calls.deletePriceAlert.length);
    this.alerts = this.alerts.filter((a) => a.id !== id);
  }

  async listNotifications(page: number, pageCount: number): Promise<Notification[]> {
    this.calls.listNotifications.push({ page, pageCount });
    this.fail('listNotifications', this.calls.listNotifications.length);
    const start = (page - 1) * pageCount;
    return this.notifications.slice(start, start + pageCount);
  }

  async hasUnreadNotifications(): Promise<boolean> {
    this.calls.hasUnreadNotifications++;
    this.fail('hasUnreadNotifications', this.calls.hasUnreadNotifications);
    return this.hasUnread;
  }

  async markNotificationsRead(ids: readonly string[]): Promise<void> {
    this.calls.markNotificationsRead.push([...ids]);
    this.fail('markNotificationsRead', this.calls.markNotificationsRead.length);
  }

  async markAllNotificationsRead(): Promise<void> {
    this.calls.markAllNotificationsRead++;
    this.fail('markAllNotificationsRead', this.calls.markAllNotificationsRead);
  }

  private update(id: string, change: (w: Watchlist) => Parameters<typeof createWatchlist>[0]): void {
    this.watchlists = this.watchlists.map((w) => (w.id === id ? createWatchlist(change(w)) : w));
  }

  private fail(method: keyof EngagementRepository, call: number): void {
    const error = this.failures[method];
    if (error) throw error;
    const once = this.failOnCall[method];
    if (once && once.call === call) throw once.error;
  }
}

const ENGAGEMENT_NOW = new Date('2026-01-15T12:00:00Z');
const ENGAGEMENT_TICKERS = ['COMI', 'HRHO', 'ETEL', 'SWDY'];

/** Market data for engagement tests: COMI/HRHO/ETEL/SWDY quoted at 100..103 (EGX30 has no quote). */
export function engagementMarket(): FakeMarketDataRepository {
  return new FakeMarketDataRepository({
    instruments: [...ENGAGEMENT_TICKERS, 'EGX30'].map((ticker) => anInstrument({ ticker })),
    quotes: {
      egypt: ENGAGEMENT_TICKERS.map((ticker, i) => aQuote({ ticker, last: 100 + i, changePercent: i })),
    },
  });
}

export interface EngagementSetup extends EngagementDependencies {
  repository: FakeEngagementRepository;
  market: FakeMarketDataRepository;
}

/** Engagement dependencies over fakes, with a real resolver and quotes cache. */
export function engagementSetup(
  repository = new FakeEngagementRepository(),
  market = engagementMarket(),
): EngagementSetup {
  return {
    repository,
    market,
    resolver: new InstrumentResolver(market),
    quotes: new MarketQuotesCache(market, fixedClock(ENGAGEMENT_NOW)),
  };
}
