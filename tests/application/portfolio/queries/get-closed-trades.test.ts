import { describe, expect, it } from 'vitest';
import { GetClosedTrades } from '../../../../src/application/portfolio/queries/get-closed-trades';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { setupPortfolio } from '../../../support/fake-portfolio';

describe('GetClosedTrades', () => {
  it('declares its contract and applies defaults', async () => {
    const { deps, repository } = setupPortfolio();
    const uc = new GetClosedTrades(deps);
    expect(uc).toMatchObject({ name: 'get_closed_trades', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ from: 'yesterday-ish' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ page_size: 5 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await uc.run({});
    expect(repository.getClosedTrades).toHaveBeenCalledWith({ market: 'egypt', page: 1, limit: 20 });
  });

  it('builds a validated journal query with Cairo market-day bounds', async () => {
    const { deps, repository } = setupPortfolio();
    await new GetClosedTrades(deps).execute({
      symbol: 'comi',
      from: '2026-01-01',
      to: '2026-01-31',
      page: 3,
      limit: 500,
    });
    expect(repository.getClosedTrades).toHaveBeenCalledWith({
      market: 'egypt',
      page: 3,
      limit: 100,
      // 00:00 and 23:59:59.999 Africa/Cairo (UTC+2 in winter)
      from: new Date('2025-12-31T22:00:00.000Z'),
      to: new Date('2026-01-31T21:59:59.999Z'),
      ticker: 'COMI',
    });
  });

  it('takes datetimes as given', async () => {
    const { deps, repository } = setupPortfolio();
    await new GetClosedTrades(deps).run({ from: '2026-01-01T10:00:00+02:00' });
    expect(repository.getClosedTrades).toHaveBeenCalledWith({
      market: 'egypt',
      page: 1,
      limit: 20,
      from: new Date('2026-01-01T08:00:00.000Z'),
    });
  });

  it('rejects invalid tickers and ranges', async () => {
    const { deps } = setupPortfolio();
    await expect(new GetClosedTrades(deps).execute({ symbol: '!!' })).rejects.toThrow(ValidationError);
    await expect(new GetClosedTrades(deps).execute({ from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow(
      /before/,
    );
  });
});
