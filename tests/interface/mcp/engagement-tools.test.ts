import { afterEach, describe, expect, it } from 'vitest';
import type * as E from '../../../src/application/engagement/use-cases.js';
import { engagementTools } from '../../../src/interface/mcp/engagement-tools.js';
import { type ConnectedClient, connect } from '../../support/mcp-client.js';
import { stub } from '../../support/use-case-stub.js';

function useCases() {
  return {
    getWatchlists: stub<E.GetWatchlists>({ watchlists: [] }),
    getWatchlist: stub<E.GetWatchlist>({ id: 'w1' }),
    createWatchlist: stub<E.CreateWatchlist>({ id: 'w1' }),
    editWatchlist: stub<E.EditWatchlist>({ id: 'w1' }),
    deleteWatchlist: stub<E.DeleteWatchlist>({ id: 'w1', deleted: true }),
    getAlerts: stub<E.GetAlerts>({ alerts: [] }),
    getAlert: stub<E.GetAlert>({ id: 'a1' }),
    createAlert: stub<E.CreateAlert>({ id: 'a1' }),
    updateAlert: stub<E.UpdateAlert>({ id: 'a2', previousId: 'a1' }),
    deleteAlert: stub<E.DeleteAlert>({ id: 'a1', deleted: true }),
    getNotifications: stub<E.GetNotifications>({ notifications: [] }),
    markNotificationsRead: stub<E.MarkNotificationsRead>({ all: true, ids: [] }),
  };
}

describe('engagement tools', () => {
  let conn: ConnectedClient;
  afterEach(async () => conn?.close());

  it('declares accurate annotations', async () => {
    conn = await connect(engagementTools(useCases()));
    const { tools } = await conn.client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(Object.keys(byName)).toHaveLength(12);
    for (const n of ['get_watchlists', 'get_watchlist', 'get_alerts', 'get_alert', 'get_notifications']) {
      expect(byName[n]?.readOnlyHint).toBe(true);
    }
    expect(byName.delete_watchlist?.destructiveHint).toBe(true);
    expect(byName.delete_alert?.destructiveHint).toBe(true);
    expect(byName.create_alert?.readOnlyHint).toBe(false);
  });

  it('maps arguments to use cases', async () => {
    const uc = useCases();
    conn = await connect(engagementTools(uc));

    await conn.call('get_watchlists', {});
    expect(uc.getWatchlists.execute).toHaveBeenCalledWith({ market: 'egypt' });
    await conn.call('get_watchlist', { id: 'w1' });
    expect(uc.getWatchlist.execute).toHaveBeenCalledWith({ id: 'w1', market: 'egypt' });
    await conn.call('create_watchlist', { name: 'Banks' });
    expect(uc.createWatchlist.execute).toHaveBeenCalledWith({ name: 'Banks', symbols: [], market: 'egypt' });
    await conn.call('edit_watchlist', { id: 'w1', name: 'B2', add: ['COMI'] });
    expect(uc.editWatchlist.execute).toHaveBeenCalledWith({
      id: 'w1',
      name: 'B2',
      add: ['COMI'],
      remove: [],
      market: 'egypt',
    });
    await conn.call('delete_watchlist', { id: 'w1' });
    expect(uc.deleteWatchlist.execute).toHaveBeenCalledWith({ id: 'w1' });

    await conn.call('get_alerts', { symbol: 'COMI' });
    expect(uc.getAlerts.execute).toHaveBeenCalledWith({
      market: 'egypt',
      symbol: 'COMI',
      page: 1,
      pageCount: 20,
    });
    await conn.call('get_alert', { id: 'a1' });
    expect(uc.getAlert.execute).toHaveBeenCalledWith({ id: 'a1', market: 'egypt' });
    await conn.call('create_alert', { symbol: 'COMI', price: 90 });
    expect(uc.createAlert.execute).toHaveBeenCalledWith({ symbol: 'COMI', price: 90, market: 'egypt' });
    expect((await conn.call('update_alert', { id: 'a1', price: 95, frequency: 'RECURRING' })).json).toEqual({
      id: 'a2',
      previousId: 'a1',
    });
    expect(uc.updateAlert.execute).toHaveBeenCalledWith({
      id: 'a1',
      price: 95,
      frequency: 'RECURRING',
      market: 'egypt',
    });
    await conn.call('delete_alert', { id: 'a1' });
    expect(uc.deleteAlert.execute).toHaveBeenCalledWith({ id: 'a1' });

    await conn.call('get_notifications', { unread_only: true });
    expect(uc.getNotifications.execute).toHaveBeenCalledWith({ page: 1, pageCount: 20, unreadOnly: true });
    await conn.call('mark_notifications_read', { all: true });
    expect(uc.markNotificationsRead.execute).toHaveBeenCalledWith({ ids: [], all: true });
  });

  it('validates input', async () => {
    const uc = useCases();
    conn = await connect(engagementTools(uc));
    expect((await conn.call('create_alert', { symbol: 'COMI', price: -1 })).isError).toBe(true);
    expect((await conn.call('create_watchlist', { name: '' })).isError).toBe(true);
    expect(
      (await conn.call('create_alert', { symbol: 'COMI', price: 1, direction: 'SIDEWAYS' })).isError,
    ).toBe(true);
    expect(uc.createAlert.execute).not.toHaveBeenCalled();
  });
});
