import { describe, expect, it } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import { GetSellJournal } from '../get-sell-journal';

describe('GetSellJournal', () => {
  it('declares its contract and applies defaults', async () => {
    const { deps, repository } = setupPortfolio();
    const uc = new GetSellJournal(deps);
    expect(uc).toMatchObject({ name: 'get_sell_journal', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ limit: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ ticker: 'COMI' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await uc.run({ market: 'us' });
    expect(repository.getSellJournal).toHaveBeenCalledWith({ market: 'us', page: 1, limit: 20 });
  });

  it('treats a date-only "to" as the end of that Cairo market day', async () => {
    const { deps, repository } = setupPortfolio();
    await new GetSellJournal(deps).run({ to: '2026-02-01', page: 2 });
    expect(repository.getSellJournal).toHaveBeenCalledWith({
      market: 'egypt',
      page: 2,
      limit: 20,
      to: new Date('2026-02-01T21:59:59.999Z'),
    });
  });

  it('rejects a "from" in the future', async () => {
    const { deps } = setupPortfolio();
    await expect(new GetSellJournal(deps).execute({ from: '2027-01-01' })).rejects.toThrow(/future/);
  });

  it('accepts a period preset', async () => {
    const { deps, repository } = setupPortfolio();
    await new GetSellJournal(deps).run({ period: 'today', symbol: 'COMI' });
    expect(repository.getSellJournal).toHaveBeenCalledWith({
      market: 'egypt',
      page: 1,
      limit: 20,
      from: new Date('2026-05-31T21:00:00.000Z'),
      ticker: 'COMI',
    });
  });
});
