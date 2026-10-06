import { describe, expect, it } from 'vitest';
import { GetNotifications } from '../../../../src/application/engagement/queries/get-notifications';
import { aNotification, FakeEngagementRepository } from '../../../support/fake-engagement';

const notifications = [
  aNotification(),
  aNotification({ id: 'n-2', read: true, createdAt: null, type: null }),
  aNotification({ id: 'n-3' }),
];

describe('GetNotifications contract', () => {
  const uc = new GetNotifications({ repository: new FakeEngagementRepository() });

  it('is the get_notifications query', () => {
    expect(uc).toMatchObject({ name: 'get_notifications', kind: 'query', context: 'engagement' });
    expect(Object.keys(uc.input)).toEqual(['page', 'pageCount', 'unreadOnly']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ unread_only: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ unreadOnly: 'yes' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ pageCount: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults to page 1 of 20, read and unread', async () => {
    const repository = new FakeEngagementRepository({ notifications });
    const out = await new GetNotifications({ repository }).run(undefined);
    expect(repository.calls.listNotifications).toEqual([{ page: 1, pageCount: 20 }]);
    expect(out.notifications).toHaveLength(3);
  });
});

describe('GetNotifications', () => {
  it('returns a page with the unread flag', async () => {
    const repository = new FakeEngagementRepository({ notifications });
    repository.hasUnread = true;
    const out = await new GetNotifications({ repository }).execute({});
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
