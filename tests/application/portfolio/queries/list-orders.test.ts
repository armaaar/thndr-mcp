import { describe, expect, it, vi } from 'vitest';
import { ListOrders } from '../../../../src/application/portfolio/queries/list-orders';
import { AssetId } from '../../../../src/domain/market-data/asset-id';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { COMI_ID, order, setupPortfolio } from '../../../support/fake-portfolio';

describe('ListOrders', () => {
  it('declares its contract and applies defaults', async () => {
    const { deps, repository } = setupPortfolio();
    const uc = new ListOrders(deps);
    expect(uc).toMatchObject({ name: 'get_account_orders', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ status: 'weird' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ oldest_first: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ limit: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const out = await uc.run({});
    expect(out).toEqual({ market: 'egypt', status: 'all', orders: [], nextCursor: null });
    expect(repository.listOrders).toHaveBeenCalledWith({
      market: 'egypt',
      status: 'all',
      limit: 20,
      sortOrder: 'DESC',
    });
  });

  it('fetches pages without over-fetching and returns the exact next cursor', async () => {
    const listOrders = vi
      .fn()
      .mockResolvedValueOnce({
        orders: Array.from({ length: 20 }, (_, i) => order(`a${i}`)),
        nextCursor: 'c1',
      })
      .mockResolvedValueOnce({
        orders: Array.from({ length: 5 }, (_, i) => order(`b${i}`)),
        nextCursor: 'c2',
      });
    const { deps } = setupPortfolio({ listOrders });
    const out = await new ListOrders(deps).run({ status: 'open', limit: 25, symbol: 'COMI' });
    expect(out.orders).toHaveLength(25);
    expect(out.nextCursor).toBe('c2');
    expect(out.status).toBe('open');
    expect(listOrders.mock.calls.map((c) => c[0])).toEqual([
      { market: 'egypt', status: 'open', limit: 20, sortOrder: 'DESC', instrumentId: AssetId.of(COMI_ID) },
      {
        market: 'egypt',
        status: 'open',
        limit: 5,
        sortOrder: 'DESC',
        cursor: 'c1',
        instrumentId: AssetId.of(COMI_ID),
      },
    ]);
  });

  it('stops at the last page, on empty pages, and honours cursor/oldestFirst', async () => {
    const last = setupPortfolio({
      listOrders: vi.fn(async () => ({ orders: [order('1')], nextCursor: null })),
    });
    const out = await new ListOrders(last.deps).run({ cursor: 'start', oldestFirst: true, limit: 50 });
    expect(out).toMatchObject({ status: 'all', nextCursor: null });
    expect(out.orders).toHaveLength(1);
    expect(last.repository.listOrders).toHaveBeenCalledWith({
      market: 'egypt',
      status: 'all',
      limit: 20,
      sortOrder: 'ASC',
      cursor: 'start',
    });
    const empty = setupPortfolio({ listOrders: vi.fn(async () => ({ orders: [], nextCursor: 'loop' })) });
    const none = await new ListOrders(empty.deps).execute({ limit: 1_000 });
    expect(none.orders).toEqual([]);
    expect(empty.repository.listOrders).toHaveBeenCalledTimes(1);
  });

  it('clamps the limit and rejects bad filters when executed directly', async () => {
    const { deps, repository } = setupPortfolio();
    await new ListOrders(deps).execute({ limit: 0 });
    expect(vi.mocked(repository.listOrders).mock.calls[0]?.[0].limit).toBe(1);
    await new ListOrders(deps).execute({ limit: Number.NaN });
    expect(vi.mocked(repository.listOrders).mock.calls[1]?.[0].limit).toBe(20);
    await expect(new ListOrders(deps).execute({ status: 'nope' as never })).rejects.toThrow(ValidationError);
  });
});
