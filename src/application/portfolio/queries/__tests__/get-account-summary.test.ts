import { describe, expect, it } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import { GetAccountSummary } from '../get-account-summary';

describe('GetAccountSummary', () => {
  it('declares its contract', async () => {
    const uc = new GetAccountSummary(setupPortfolio().deps);
    expect(uc).toMatchObject({ name: 'get_account_summary', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ extra: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('returns the summary with market and position count (default market)', async () => {
    const { deps, repository } = setupPortfolio();
    const out = await new GetAccountSummary(deps).run(undefined);
    expect(repository.getAccount).toHaveBeenCalledWith('egypt');
    expect(out).toMatchObject({
      market: 'egypt',
      availableCash: 800,
      totalAccountValue: 11_000,
      positions: 3,
    });
  });
});
