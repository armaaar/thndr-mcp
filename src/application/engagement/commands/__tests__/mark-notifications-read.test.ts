import { describe, expect, it } from 'vitest';
import { FakeEngagementRepository } from '../../../../__tests__/support/fake-engagement';
import { MarkNotificationsRead } from '../mark-notifications-read';

describe('MarkNotificationsRead contract', () => {
  const uc = new MarkNotificationsRead({ repository: new FakeEngagementRepository() });

  it('is the idempotent, non-destructive mark_notifications_read command', () => {
    expect(uc).toMatchObject({
      name: 'mark_notifications_read',
      kind: 'command',
      context: 'engagement',
      destructive: false,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['ids', 'all']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ ids: ['n1'], market: 'egypt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ ids: [''] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ all: 'yes' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('defaults to no ids and all=false', async () => {
    await expect(uc.run({})).rejects.toThrow('Provide notification ids, or all=true');
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
