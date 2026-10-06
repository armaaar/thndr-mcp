import { describe, expect, it, vi } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import { createAccountActivity } from '../../../../domain/portfolio/activity';
import { ListAccountActivity } from '../list-account-activity';

const activities = [
  createAccountActivity({
    id: '1',
    type: 'BUY_ORDER',
    amount: -10,
    createdAt: null,
    description: null,
    ticker: null,
  }),
  createAccountActivity({
    id: '2',
    type: 'DIVIDEND',
    amount: 5,
    createdAt: null,
    description: null,
    ticker: null,
  }),
];

describe('ListAccountActivity', () => {
  it('declares its contract and applies defaults', async () => {
    const listActivities = vi.fn(async () => ({ activities, page: 1, hasMore: false }));
    const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
    expect(uc).toMatchObject({ name: 'get_account_activity', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ category: 'bitcoin' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ page_size: 5 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ pageSize: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const out = await uc.run({});
    expect(listActivities).toHaveBeenCalledWith('egypt', 1, 20);
    expect(out).toMatchObject({ market: 'egypt', page: 1, hasMore: false });
    expect(out.activities).toHaveLength(2);
  });

  it('lists a page and filters by category', async () => {
    const listActivities = vi.fn(async () => ({ activities, page: 2, hasMore: true }));
    const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
    const page = await uc.run({ page: 2, pageSize: 5 });
    expect(listActivities).toHaveBeenCalledWith('egypt', 2, 5);
    expect(page).toMatchObject({ market: 'egypt', page: 2, hasMore: true });
    const dividends = await uc.run({ category: 'DIVIDEND' });
    expect(dividends.activities.map((a) => a.id)).toEqual(['2']);
    expect(listActivities).toHaveBeenLastCalledWith('egypt', 1, 20);
  });

  it('normalizes categories when executed directly', async () => {
    const listActivities = vi.fn(async () => ({ activities, page: 1, hasMore: false }));
    const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
    expect((await uc.execute({ category: 'dividend' as never })).activities.map((a) => a.id)).toEqual(['2']);
    expect((await uc.execute({ category: 'all' as never })).activities).toHaveLength(2);
    expect((await uc.execute({ category: '' as never })).activities).toHaveLength(2);
    await expect(uc.execute({ category: 'bitcoin' as never })).rejects.toThrow(
      /Unsupported activity category/,
    );
  });
});
