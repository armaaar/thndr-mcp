import { describe, expect, it, vi } from 'vitest';
import { GetPosition } from '../../../../src/application/portfolio/queries/get-position';
import { AssetId } from '../../../../src/domain/market-data/asset-id';
import { COMI_ID, setupPortfolio } from '../../../support/fake-portfolio';

describe('GetPosition', () => {
  it('declares its contract', async () => {
    const uc = new GetPosition(setupPortfolio().deps);
    expect(uc).toMatchObject({ name: 'get_position', kind: 'query', context: 'portfolio' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', include_sellable: true })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ symbol: 'COMI', market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('does not include sellable quantity by default', async () => {
    const { deps, repository } = setupPortfolio();
    const out = await new GetPosition(deps).run({ symbol: 'comi' });
    expect(repository.getPosition).toHaveBeenCalledWith(AssetId.of(COMI_ID), 'egypt');
    expect(out).toMatchObject({ ticker: 'COMI', held: true, sellable: null });
    expect(repository.getSellableQuantity).not.toHaveBeenCalled();
  });

  it('includes sellable quantity on request', async () => {
    const { deps } = setupPortfolio();
    const out = await new GetPosition(deps).run({ symbol: COMI_ID, includeSellable: true });
    expect(out).toMatchObject({ ticker: 'COMI', held: true, sellable: { custodian: 'THN' } });
  });

  it('skips sellable quantity when not held', async () => {
    const none = setupPortfolio({ getPosition: vi.fn(async () => null) });
    const notHeld = await new GetPosition(none.deps).run({ symbol: 'HRHO', includeSellable: true });
    expect(notHeld).toEqual({ ticker: 'HRHO', held: false, position: null, sellable: null });
    expect(none.repository.getSellableQuantity).not.toHaveBeenCalled();
  });
});
