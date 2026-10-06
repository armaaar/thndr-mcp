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

  describe('with a date range', () => {
    const at = (id: string, createdAt: string | null, type = 'BUY_ORDER') =>
      createAccountActivity({
        id,
        type,
        amount: 1,
        createdAt: createdAt ? new Date(createdAt) : null,
        description: null,
        ticker: null,
      });

    it('pages through 100-row pages until entries are older than the period start', async () => {
      const pages = [
        {
          activities: [
            at('a', '2026-06-01T08:00:00Z'),
            at('b', '2026-05-28T08:00:00Z'),
            at('n', null),
            at('c', '2026-05-30T08:00:00Z'),
          ],
          page: 1,
          hasMore: true,
        },
        {
          // 7d starts 2026-05-26 00:00 Cairo = 2026-05-25T21:00Z.
          activities: [at('d', '2026-05-25T21:00:00Z'), at('old', '2026-05-25T20:59:59Z')],
          page: 2,
          hasMore: true,
        },
      ];
      const listActivities = vi.fn(async (_m: string, page: number) => pages[page - 1] as never);
      const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
      const out = await uc.run({ period: '7d' });
      expect(listActivities.mock.calls).toEqual([
        ['egypt', 1, 100],
        ['egypt', 2, 100],
      ]);
      expect(out.activities.map((a) => a.id)).toEqual(['a', 'c', 'b', 'd']);
      expect(out).toMatchObject({
        market: 'egypt',
        page: 1,
        hasMore: false,
        truncated: false,
        pagesFetched: 2,
        range: { from: new Date('2026-05-25T21:00:00Z'), to: null },
      });
    });

    it('stops at the page cap and reports truncation', async () => {
      const listActivities = vi.fn(async (_m: string, page: number) => ({
        activities: [at(`p${page}`, '2026-05-31T08:00:00Z')],
        page,
        hasMore: true,
      }));
      const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
      const out = await uc.run({ period: 'ytd', market: 'us' });
      expect(listActivities).toHaveBeenCalledTimes(ListAccountActivity.RANGE_MAX_PAGES);
      expect(listActivities).toHaveBeenLastCalledWith('us', 20, 100);
      expect(out).toMatchObject({ truncated: true, hasMore: true, pagesFetched: 20 });
      expect(out.activities).toHaveLength(20);
    });

    it('applies explicit from/to bounds and the category filter, up to the last page', async () => {
      const listActivities = vi.fn(async () => ({
        activities: [
          at('new', '2026-05-20T08:00:00Z'),
          at('div', '2026-05-10T08:00:00Z', 'DIVIDEND'),
          at('buy', '2026-05-09T08:00:00Z'),
        ],
        page: 1,
        hasMore: false,
      }));
      const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
      const out = await uc.run({ to: '2026-05-15', category: 'DIVIDEND' });
      expect(listActivities).toHaveBeenCalledTimes(1);
      expect(out.activities.map((a) => a.id)).toEqual(['div']);
      expect(out).toMatchObject({ truncated: false, range: { from: null } });
      const ranged = await uc.run({ from: '2026-05-10', to: '2026-05-15' });
      expect(ranged.activities.map((a) => a.id)).toEqual(['div']);
    });

    it('rejects a period combined with from/to, a page number, or a future start', async () => {
      const listActivities = vi.fn();
      const uc = new ListAccountActivity(setupPortfolio({ listActivities }).deps);
      await expect(uc.run({ period: '30d', from: '2026-05-01' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/either "period" or "from"\/"to"/),
      });
      await expect(uc.run({ period: '30d', page: 2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(uc.run({ from: '2027-01-01' })).rejects.toThrow(/Activity "from" is in the future/);
      await expect(uc.run({ period: 'decade' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(listActivities).not.toHaveBeenCalled();
    });
  });
});
