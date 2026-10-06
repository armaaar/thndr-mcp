import { describe, expect, it } from 'vitest';
import {
  ALERT_SCAN_MAX_PAGES,
  ALERT_SCAN_PAGE_SIZE,
  CreateAlert,
  CreateWatchlist,
  DeleteAlert,
  DeleteWatchlist,
  EditWatchlist,
  type EngagementDependencies,
  GetAlert,
  GetAlerts,
  GetNotifications,
  GetWatchlist,
  GetWatchlists,
  MarkNotificationsRead,
  UpdateAlert,
} from '../../../src/application/engagement/use-cases.js';
import { NotFoundError, UpstreamError } from '../../../src/application/errors.js';
import { InstrumentResolver } from '../../../src/application/market-data/instrument-resolver.js';
import { MarketQuotesCache } from '../../../src/application/market-data/quote-cache.js';
import { ValidationError } from '../../../src/domain/shared-kernel/errors.js';
import {
  aNotification,
  anAlert,
  aWatchlist,
  FakeEngagementRepository,
} from '../../support/fake-engagement.js';
import {
  anInstrument,
  aQuote,
  FakeMarketDataRepository,
  fixedClock,
  idFor,
} from '../../support/fake-market-data.js';

const NOW = new Date('2026-01-15T12:00:00Z');
const TICKERS = ['COMI', 'HRHO', 'ETEL', 'SWDY'];

interface Setup extends EngagementDependencies {
  repository: FakeEngagementRepository;
  market: FakeMarketDataRepository;
}

function setup(repository = new FakeEngagementRepository(), market = defaultMarket()): Setup {
  const resolver = new InstrumentResolver(market);
  return { repository, market, resolver, quotes: new MarketQuotesCache(market, fixedClock(NOW)) };
}

function defaultMarket(): FakeMarketDataRepository {
  return new FakeMarketDataRepository({
    instruments: [...TICKERS, 'EGX30'].map((ticker) => anInstrument({ ticker })),
    quotes: {
      egypt: TICKERS.map((ticker, i) => aQuote({ ticker, last: 100 + i, changePercent: i })),
    },
  });
}

// ---------------------------------------------------------------- watchlists

describe('GetWatchlists', () => {
  it('lists watchlists of the default market with tickers', async () => {
    const deps = setup(
      new FakeEngagementRepository({
        watchlists: [aWatchlist({ tickers: ['COMI', 'EGX30'] }), aWatchlist({ id: 'wl-2', tickers: [] })],
      }),
    );
    const out = await new GetWatchlists(deps).execute();
    expect(deps.repository.calls.listWatchlists).toEqual(['egypt']);
    expect(out).toEqual({
      market: 'egypt',
      watchlists: [
        {
          id: 'wl-1',
          name: 'Banks',
          color: 'color_4',
          icon: 'thndr',
          count: 2,
          instruments: [
            { instrumentId: idFor('COMI'), ticker: 'COMI' },
            { instrumentId: idFor('EGX30'), ticker: 'EGX30' },
          ],
        },
        { id: 'wl-2', name: 'Banks', color: 'color_4', icon: 'thndr', count: 0, instruments: [] },
      ],
    });
  });

  it('parses the market', async () => {
    const deps = setup();
    expect((await new GetWatchlists(deps).execute({ market: 'USA' })).market).toBe('us');
  });
});

describe('GetWatchlist', () => {
  it('reads the detail, borrows the name from the list and adds live prices', async () => {
    const deps = setup(
      new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: ['HRHO', 'GONE'] })] }),
    );
    const out = await new GetWatchlist(deps).execute({ id: ' wl-1 ' });
    expect(deps.repository.calls.getWatchlist).toEqual(['wl-1']);
    expect(out).toEqual({
      id: 'wl-1',
      name: 'Banks',
      color: 'color_4',
      icon: 'thndr',
      count: 2,
      market: 'egypt',
      instruments: [
        { instrumentId: idFor('HRHO'), ticker: 'HRHO', name: 'HRHO Corp', last: 101, changePercent: 1 },
        { instrumentId: idFor('GONE'), ticker: null, name: null, last: null, changePercent: null },
      ],
    });
  });

  it('keeps an empty name when the list misses it or fails', async () => {
    const repository = new FakeEngagementRepository({ watchlists: [aWatchlist()] });
    const deps = setup(repository);
    repository.failures.listWatchlists = new Error('down');
    expect((await new GetWatchlist(deps).execute({ id: 'wl-1' })).name).toBe('');
    delete repository.failures.listWatchlists;
    repository.getWatchlist = async () => aWatchlist({ id: 'other', name: '' });
    expect(await new GetWatchlist(deps).execute({ id: 'other' })).toMatchObject({ id: 'other', name: '' });
  });

  it('skips the list lookup when the detail has a name', async () => {
    const repository = new FakeEngagementRepository();
    repository.getWatchlist = async () => aWatchlist({ name: 'Detail' });
    const deps = setup(repository);
    expect((await new GetWatchlist(deps).execute({ id: 'wl-1', market: 'egx' })).name).toBe('Detail');
    expect(repository.calls.listWatchlists).toEqual([]);
  });

  it('validates the id', async () => {
    await expect(new GetWatchlist(setup()).execute({ id: ' ' })).rejects.toThrow(ValidationError);
  });
});

describe('CreateWatchlist', () => {
  it('resolves and dedupes symbols, then creates', async () => {
    const deps = setup();
    const out = await new CreateWatchlist(deps).execute({
      name: ' Banks ',
      symbols: ['comi', 'HRHO', idFor('COMI')],
    });
    expect(deps.repository.calls.createWatchlist).toEqual([
      { name: 'Banks', market: 'egypt', ids: [idFor('COMI'), idFor('HRHO')] },
    ]);
    expect(out).toMatchObject({ id: 'wl-100', name: 'Banks', count: 2, market: 'egypt' });
    expect(out.instruments.map((i) => i.ticker)).toEqual(['COMI', 'HRHO']);
  });

  it('creates an empty watchlist', async () => {
    const deps = setup();
    const out = await new CreateWatchlist(deps).execute({ name: 'Empty', market: 'us' });
    expect(deps.repository.calls.createWatchlist).toEqual([{ name: 'Empty', market: 'us', ids: [] }]);
    expect(out.instruments).toEqual([]);
  });

  it('validates the name, symbol count and symbols before writing', async () => {
    const deps = setup();
    const uc = new CreateWatchlist(deps);
    await expect(uc.execute({ name: '' })).rejects.toThrow('Watchlist name must not be empty');
    await expect(
      uc.execute({ name: 'x', symbols: Array.from({ length: 101 }, () => 'COMI') }),
    ).rejects.toThrow('At most 100 symbols in "symbols"');
    await expect(uc.execute({ name: 'x', symbols: ['NOPE'] })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.createWatchlist).toEqual([]);
  });
});

describe('EditWatchlist', () => {
  it('renames, adds and removes in that order, then re-reads', async () => {
    const deps = setup(
      new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: ['COMI', 'GONE'] })] }),
    );
    const out = await new EditWatchlist(deps).execute({
      id: 'wl-1',
      name: 'Top',
      add: ['HRHO', 'hrho'],
      remove: [idFor('GONE'), 'COMI'],
    });
    expect(deps.repository.calls.renameWatchlist).toEqual([{ id: 'wl-1', name: 'Top' }]);
    expect(deps.repository.calls.addToWatchlist).toEqual([{ id: 'wl-1', ids: [idFor('HRHO')] }]);
    expect(deps.repository.calls.removeFromWatchlist).toEqual([
      { id: 'wl-1', ids: [idFor('GONE'), idFor('COMI')] },
    ]);
    expect(out.name).toBe('Top');
    expect(out.instruments.map((i) => i.ticker)).toEqual(['HRHO']);
    expect(out.changes).toEqual({
      renamed: true,
      added: [idFor('HRHO')],
      removed: [idFor('GONE'), idFor('COMI')],
    });
    // The unknown id was removed without an instrument lookup.
    expect(deps.market.calls.getInstrument.map((i) => i.value)).not.toContain(idFor('GONE'));
  });

  it('only adds', async () => {
    const deps = setup(new FakeEngagementRepository({ watchlists: [aWatchlist({ tickers: [] })] }));
    const out = await new EditWatchlist(deps).execute({ id: 'wl-1', add: ['ETEL'], market: 'egypt' });
    expect(deps.repository.calls.renameWatchlist).toEqual([]);
    expect(deps.repository.calls.removeFromWatchlist).toEqual([]);
    expect(out).toMatchObject({
      name: 'Banks',
      changes: { renamed: false, added: [idFor('ETEL')], removed: [] },
    });
  });

  it('only renames', async () => {
    const deps = setup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    const out = await new EditWatchlist(deps).execute({ id: 'wl-1', name: 'Renamed', add: [], remove: [] });
    expect(deps.repository.calls.addToWatchlist).toEqual([]);
    expect(out.changes).toEqual({ renamed: true, added: [], removed: [] });
  });

  it('rejects empty edits, conflicts and oversize lists without writing', async () => {
    const deps = setup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    const uc = new EditWatchlist(deps);
    await expect(uc.execute({ id: 'wl-1' })).rejects.toThrow('Nothing to change');
    await expect(uc.execute({ id: 'wl-1', add: ['COMI'], remove: [idFor('COMI')] })).rejects.toThrow(
      'both added and removed',
    );
    await expect(uc.execute({ id: 'wl-1', remove: Array.from({ length: 101 }, () => 'X') })).rejects.toThrow(
      'At most 100 symbols in "remove"',
    );
    await expect(uc.execute({ id: 'wl-1', name: '  ' })).rejects.toThrow(ValidationError);
    await expect(uc.execute({ id: '', name: 'x' })).rejects.toThrow('Watchlist id must not be empty');
    expect(deps.repository.calls.renameWatchlist).toEqual([]);
    expect(deps.repository.calls.addToWatchlist).toEqual([]);
  });
});

describe('DeleteWatchlist', () => {
  it('deletes by id', async () => {
    const deps = setup(new FakeEngagementRepository({ watchlists: [aWatchlist()] }));
    expect(await new DeleteWatchlist(deps).execute({ id: ' wl-1 ' })).toEqual({ id: 'wl-1', deleted: true });
    expect(deps.repository.calls.deleteWatchlist).toEqual(['wl-1']);
    await expect(new DeleteWatchlist(deps).execute({ id: '' })).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------- price alerts

function alerts(n: number) {
  return Array.from({ length: n }, (_, i) => anAlert({ id: `a-${i}`, targetPrice: 100 + i }));
}

describe('GetAlerts', () => {
  it('returns one page with tickers and current prices', async () => {
    const deps = setup(
      new FakeEngagementRepository({
        alerts: [
          anAlert(),
          anAlert({ id: 'a-2', ticker: null, instrumentId: idFor('HRHO'), direction: null }),
        ],
      }),
    );
    const out = await new GetAlerts(deps).execute();
    expect(deps.repository.calls.listPriceAlerts).toEqual([{ market: 'egypt', page: 1, pageCount: 20 }]);
    expect(out).toEqual({
      market: 'egypt',
      page: 1,
      pageCount: 20,
      hasMore: false,
      alerts: [
        {
          id: 'a-1',
          instrumentId: idFor('COMI'),
          ticker: 'COMI',
          targetPrice: 110,
          direction: 'UP',
          frequency: 'ONE_TIME',
          createdAt: '2026-01-01T09:00:00.000Z',
          currentPrice: 100,
        },
        {
          id: 'a-2',
          instrumentId: idFor('HRHO'),
          ticker: 'HRHO',
          targetPrice: 110,
          direction: null,
          frequency: 'ONE_TIME',
          createdAt: '2026-01-01T09:00:00.000Z',
          currentPrice: 101,
        },
      ],
    });
  });

  it('clamps paging and reports more pages', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: alerts(5) }));
    const uc = new GetAlerts(deps);
    const out = await uc.execute({ page: 2, pageCount: 2 });
    expect(out).toMatchObject({ page: 2, pageCount: 2, hasMore: true });
    expect(out.alerts.map((a) => a.id)).toEqual(['a-2', 'a-3']);
    await uc.execute({ page: 0, pageCount: 1000 });
    await uc.execute({ page: Number.NaN, pageCount: 2.7 });
    expect(deps.repository.calls.listPriceAlerts.slice(1)).toEqual([
      { market: 'egypt', page: 1, pageCount: 100 },
      { market: 'egypt', page: 1, pageCount: 2 },
    ]);
  });

  it('lists the alerts of one symbol', async () => {
    const deps = setup(
      new FakeEngagementRepository({
        alerts: [anAlert(), anAlert({ id: 'h', ticker: 'HRHO', createdAt: null })],
      }),
    );
    const out = await new GetAlerts(deps).execute({ symbol: 'hrho' });
    expect(deps.repository.calls.listAlertsForInstrument).toEqual([idFor('HRHO')]);
    expect(out).toMatchObject({ page: 1, pageCount: 1, hasMore: false });
    expect(out.alerts).toEqual([expect.objectContaining({ id: 'h', ticker: 'HRHO', createdAt: null })]);
  });
});

describe('GetAlert', () => {
  it('scans pages until it finds the id', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: alerts(ALERT_SCAN_PAGE_SIZE + 3) }));
    const out = await new GetAlert(deps).execute({ id: `a-${ALERT_SCAN_PAGE_SIZE + 1}` });
    expect(out.id).toBe(`a-${ALERT_SCAN_PAGE_SIZE + 1}`);
    expect(deps.repository.calls.listPriceAlerts.map((c) => c.page)).toEqual([1, 2]);
  });

  it('stops at a short page', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: alerts(3) }));
    await expect(new GetAlert(deps).execute({ id: 'zzz', market: 'us' })).rejects.toThrow(
      'No us price alert with id zzz',
    );
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(1);
  });

  it('caps the number of pages scanned', async () => {
    const deps = setup(
      new FakeEngagementRepository({ alerts: alerts(ALERT_SCAN_PAGE_SIZE * (ALERT_SCAN_MAX_PAGES + 1)) }),
    );
    await expect(new GetAlert(deps).execute({ id: 'zzz' })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(ALERT_SCAN_MAX_PAGES);
  });

  it('validates the id', async () => {
    await expect(new GetAlert(setup()).execute({ id: '' })).rejects.toThrow('Alert id must not be empty');
  });
});

describe('CreateAlert', () => {
  it('derives DOWN below the last price and defaults to ONE_TIME', async () => {
    const deps = setup();
    const out = await new CreateAlert(deps).execute({ symbol: 'comi', price: 95 });
    expect(deps.repository.calls.createPriceAlert).toEqual([
      { instrumentId: idFor('COMI'), price: 95, direction: 'DOWN', frequency: 'ONE_TIME', market: 'egypt' },
    ]);
    expect(out).toEqual({
      id: 'a-100',
      instrumentId: idFor('COMI'),
      ticker: 'COMI',
      targetPrice: 95,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      createdAt: '2026-01-15T12:00:00.000Z',
      currentPrice: 100,
    });
  });

  it('derives UP at or above the last price', async () => {
    const deps = setup();
    await new CreateAlert(deps).execute({ symbol: 'COMI', price: 100, frequency: 'recurring' });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      direction: 'UP',
      frequency: 'RECURRING',
    });
  });

  it('honours an explicit direction without a quote lookup', async () => {
    const deps = setup();
    await new CreateAlert(deps).execute({ symbol: 'EGX30', price: 30_000, direction: 'below' });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({ direction: 'DOWN' });
  });

  it('requires a direction when there is no current price', async () => {
    const market = defaultMarket();
    market.quotes.egypt = [aQuote({ ticker: 'COMI', last: 0 })];
    const deps = setup(new FakeEngagementRepository(), market);
    const uc = new CreateAlert(deps);
    await expect(uc.execute({ symbol: 'EGX30', price: 1 })).rejects.toThrow(
      'No current price for EGX30, so the alert direction cannot be derived',
    );
    await expect(uc.execute({ symbol: 'COMI', price: 1 })).rejects.toThrow(ValidationError);
    expect(deps.repository.calls.createPriceAlert).toEqual([]);
  });

  it('validates price, direction and frequency before resolving', async () => {
    const deps = setup();
    const uc = new CreateAlert(deps);
    await expect(uc.execute({ symbol: 'COMI', price: -1 })).rejects.toThrow('greater than zero');
    await expect(uc.execute({ symbol: 'COMI', price: 1, direction: 'x' })).rejects.toThrow('direction');
    await expect(uc.execute({ symbol: 'COMI', price: 1, frequency: 'x' })).rejects.toThrow('frequency');
    expect(deps.market.calls.searchInstruments).toEqual([]);
  });

  it('finds the created alert in the asset list when the reply is opaque', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [
        anAlert({ id: 'old', targetPrice: 95, direction: 'UP' }),
        anAlert({ id: 'srv', targetPrice: 95, direction: null, frequency: null }),
      ],
    });
    repository.createReturnsAlert = false;
    const deps = setup(repository);
    const out = await new CreateAlert(deps).execute({ symbol: 'COMI', price: 95, direction: 'DOWN' });
    expect(out.id).toBe('srv');
    expect(repository.calls.listAlertsForInstrument).toEqual([idFor('COMI')]);
  });

  it('matches on direction and frequency when known', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [anAlert({ id: 'recurring', targetPrice: 95, direction: 'DOWN', frequency: 'RECURRING' })],
    });
    repository.createReturnsAlert = false;
    const out = await new CreateAlert(setup(repository)).execute({
      symbol: 'COMI',
      price: 95,
      direction: 'DOWN',
    });
    // The fake also stored the new alert (a-100), which matches exactly.
    expect(out.id).toBe('a-100');
  });

  it('returns a null id when the alert cannot be identified', async () => {
    const repository = new FakeEngagementRepository();
    repository.createReturnsAlert = false;
    repository.failures.listAlertsForInstrument = new Error('down');
    const out = await new CreateAlert(setup(repository)).execute({ symbol: 'HRHO', price: 50 });
    expect(out).toEqual({
      id: null,
      instrumentId: idFor('HRHO'),
      ticker: 'HRHO',
      targetPrice: 50,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      createdAt: null,
      currentPrice: 101,
    });
  });
});

describe('UpdateAlert', () => {
  it('deletes then re-creates with a new price, re-deriving the direction', async () => {
    const deps = setup(
      new FakeEngagementRepository({ alerts: [anAlert({ targetPrice: 110, direction: 'UP' })] }),
    );
    const out = await new UpdateAlert(deps).execute({ id: 'a-1', price: 90 });
    expect(deps.repository.calls.deletePriceAlert).toEqual(['a-1']);
    expect(deps.repository.calls.createPriceAlert).toEqual([
      { instrumentId: idFor('COMI'), price: 90, direction: 'DOWN', frequency: 'ONE_TIME', market: 'egypt' },
    ]);
    expect(out).toMatchObject({ id: 'a-100', previousId: 'a-1', targetPrice: 90, direction: 'DOWN' });
  });

  it('keeps price and direction when only the frequency changes', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: [anAlert({ direction: 'DOWN' })] }));
    await new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'RECURRING' });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      price: 110,
      direction: 'DOWN',
      frequency: 'RECURRING',
    });
  });

  it('keeps the direction when the same price is passed', async () => {
    const deps = setup(
      new FakeEngagementRepository({ alerts: [anAlert({ direction: 'DOWN', frequency: null })] }),
    );
    await new UpdateAlert(deps).execute({ id: 'a-1', price: 110 });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({
      direction: 'DOWN',
      frequency: 'ONE_TIME',
    });
  });

  it('derives a missing direction and honours an explicit one', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: [anAlert({ direction: null })] }));
    await new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'once' });
    expect(deps.repository.calls.createPriceAlert[0]).toMatchObject({ direction: 'UP' });
    await new UpdateAlert(deps).execute({ id: 'a-100', direction: 'down', price: 120 });
    expect(deps.repository.calls.createPriceAlert[1]).toMatchObject({ direction: 'DOWN', price: 120 });
  });

  it('refuses to derive without a quote, naming the instrument id when the ticker is unknown', async () => {
    const deps = setup(
      new FakeEngagementRepository({ alerts: [anAlert({ ticker: null, instrumentId: idFor('NOQUOTE') })] }),
    );
    await expect(new UpdateAlert(deps).execute({ id: 'a-1', price: 5 })).rejects.toThrow(
      `No current price for ${idFor('NOQUOTE')}`,
    );
    expect(deps.repository.calls.deletePriceAlert).toEqual([]);
  });

  it('validates input before touching upstream', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    const uc = new UpdateAlert(deps);
    await expect(uc.execute({ id: 'a-1' })).rejects.toThrow('Nothing to change');
    await expect(uc.execute({ id: 'a-1', price: 0 })).rejects.toThrow('greater than zero');
    await expect(uc.execute({ id: ' ', price: 1 })).rejects.toThrow('Alert id must not be empty');
    await expect(uc.execute({ id: 'missing', price: 1 })).rejects.toThrow(NotFoundError);
    expect(deps.repository.calls.listPriceAlerts).toHaveLength(1);
  });

  it('restores the original alert when re-creation fails', async () => {
    const repository = new FakeEngagementRepository({
      alerts: [anAlert({ direction: null, frequency: null })],
    });
    repository.failOnCall.createPriceAlert = { call: 1, error: new Error('rejected') };
    const deps = setup(repository);
    const error = await new UpdateAlert(deps).execute({ id: 'a-1', price: 90 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe(
      'Could not re-create alert a-1 with the new values (rejected). The original alert was restored (with a new id).',
    );
    expect(repository.calls.createPriceAlert[1]).toEqual({
      instrumentId: idFor('COMI'),
      price: 110,
      direction: 'DOWN',
      frequency: 'ONE_TIME',
      market: 'egypt',
    });
  });

  it('reports when the original alert cannot be restored', async () => {
    const repository = new FakeEngagementRepository({ alerts: [anAlert()] });
    repository.failures.createPriceAlert = 'nope' as unknown as Error;
    const deps = setup(repository);
    await expect(new UpdateAlert(deps).execute({ id: 'a-1', frequency: 'RECURRING' })).rejects.toThrow(
      'Could not re-create alert a-1 with the new values (nope). The original alert could not be restored',
    );
    expect(repository.calls.createPriceAlert).toEqual([
      expect.objectContaining({ frequency: 'RECURRING', direction: 'UP' }),
      expect.objectContaining({ frequency: 'ONE_TIME', direction: 'UP' }),
    ]);
  });
});

describe('DeleteAlert', () => {
  it('deletes by id', async () => {
    const deps = setup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    expect(await new DeleteAlert(deps).execute({ id: 'a-1' })).toEqual({ id: 'a-1', deleted: true });
    expect(deps.repository.calls.deletePriceAlert).toEqual(['a-1']);
    await expect(new DeleteAlert(deps).execute({ id: '' })).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------- notifications

describe('GetNotifications', () => {
  const notifications = [
    aNotification(),
    aNotification({ id: 'n-2', read: true, createdAt: null, type: null }),
    aNotification({ id: 'n-3' }),
  ];

  it('returns a page with the unread flag', async () => {
    const repository = new FakeEngagementRepository({ notifications });
    repository.hasUnread = true;
    const out = await new GetNotifications({ repository }).execute();
    expect(repository.calls.listNotifications).toEqual([{ page: 1, pageCount: 20 }]);
    expect(repository.calls.hasUnreadNotifications).toBe(1);
    expect(out).toMatchObject({ page: 1, pageCount: 20, hasMore: false, hasUnread: true });
    expect(out.notifications[0]).toEqual({
      id: 'n-1',
      title: 'Order completed',
      text: 'Your order for COMI was executed',
      read: false,
      createdAt: '2026-01-01T10:00:00.000Z',
      type: 'order_completed',
    });
    expect(out.notifications[1]).toMatchObject({ id: 'n-2', createdAt: null, type: null });
  });

  it('filters unread and clamps paging', async () => {
    const repository = new FakeEngagementRepository({ notifications });
    const uc = new GetNotifications({ repository });
    const out = await uc.execute({ unreadOnly: true, pageCount: 3 });
    expect(out.hasMore).toBe(true);
    expect(out.notifications.map((n) => n.id)).toEqual(['n-1', 'n-3']);
    await uc.execute({ page: -5, pageCount: 0 });
    expect(repository.calls.listNotifications[1]).toEqual({ page: 1, pageCount: 1 });
  });
});

describe('MarkNotificationsRead', () => {
  it('marks given ids (trimmed, deduped)', async () => {
    const repository = new FakeEngagementRepository();
    const out = await new MarkNotificationsRead({ repository }).execute({ ids: [' n1', 'n2', 'n1'] });
    expect(out).toEqual({ all: false, ids: ['n1', 'n2'] });
    expect(repository.calls.markNotificationsRead).toEqual([['n1', 'n2']]);
  });

  it('marks everything read', async () => {
    const repository = new FakeEngagementRepository();
    expect(await new MarkNotificationsRead({ repository }).execute({ all: true, ids: [] })).toEqual({
      all: true,
      ids: [],
    });
    expect(repository.calls.markAllNotificationsRead).toBe(1);
  });

  it('validates the input', async () => {
    const repository = new FakeEngagementRepository();
    const uc = new MarkNotificationsRead({ repository });
    await expect(uc.execute({})).rejects.toThrow('Provide notification ids, or all=true');
    await expect(uc.execute({ all: false, ids: [] })).rejects.toThrow('Provide notification ids');
    await expect(uc.execute({ all: true, ids: ['n1'] })).rejects.toThrow('not both');
    await expect(uc.execute({ ids: [' '] })).rejects.toThrow('Notification id must not be empty');
    await expect(uc.execute({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) })).rejects.toThrow(
      'At most 200',
    );
    expect(repository.calls.markNotificationsRead).toEqual([]);
    expect(repository.calls.markAllNotificationsRead).toBe(0);
  });
});
