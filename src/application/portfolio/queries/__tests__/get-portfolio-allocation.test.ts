import { describe, expect, it, vi } from 'vitest';
import { aQuote, idFor } from '../../../../__tests__/support/fake-market-data';
import { position, setupPortfolio, summary } from '../../../../__tests__/support/fake-portfolio';
import { createAccountSummary } from '../../../../domain/portfolio/account-summary';
import { AssetId } from '../../../../domain/shared-kernel/asset-id';
import { GetPortfolioAllocation } from '../get-portfolio-allocation';

const EGX30 = idFor('EGX30');
const SHARIAH = idFor('SHARIAH');

function setup() {
  const getAccount = vi.fn(async () => ({
    summary: createAccountSummary({ ...summary, portfolioValue: 10_000 }),
    positions: [
      // Joined by instrument id.
      position('COMI', 60, { instrumentId: AssetId.of(idFor('COMI')) }),
      // No instrument id on the position: joined by ticker, membership through the quote's id.
      position('HRHO', 30),
      // A mutual fund: not a marketwatch row.
      position('BMM', 10, { assetClass: 'FUND' }),
      // A stock the snapshot gives no sector for.
      position('NOSEC', 0, { instrumentId: AssetId.of(idFor('NOSEC')) }),
    ],
  }));
  const { deps, md } = setupPortfolio({ getAccount });
  vi.mocked(md.getMarketQuotes).mockResolvedValue([
    aQuote({ ticker: 'COMI', sector: 'Banks' }),
    aQuote({ ticker: 'HRHO', sector: 'Non-bank Financial Services' }),
    aQuote({ ticker: 'NOSEC', sector: null }),
    aQuote({ ticker: 'EGX30', board: 'INDX', sector: null }),
    aQuote({ ticker: 'SHARIAH', board: 'INDX', sector: null }),
  ]);
  vi.mocked(md.getIndexConstituents).mockImplementation(async (id: AssetId) => {
    if (id.value === EGX30) return [AssetId.of(idFor('COMI')), AssetId.of(idFor('HRHO'))];
    if (id.value === SHARIAH) return [AssetId.of(idFor('COMI'))];
    return [];
  });
  return { deps, md, getAccount };
}

describe('GetPortfolioAllocation', () => {
  it('declares its contract', async () => {
    const uc = new GetPortfolioAllocation(setup().deps);
    expect(uc).toMatchObject({ name: 'get_portfolio_allocation', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('weights holdings and groups them by asset class, sector and index', async () => {
    const { deps, getAccount } = setup();
    const out = await new GetPortfolioAllocation(deps).run({});
    expect(getAccount).toHaveBeenCalledWith('egypt');
    expect(out).toMatchObject({ market: 'egypt', currency: 'EGP', basis: 10_000, totalMarketValue: 10_000 });
    expect(out.holdings).toEqual([
      {
        ticker: 'COMI',
        instrumentId: idFor('COMI'),
        assetClass: 'STOCK',
        sector: 'Banks',
        indices: ['EGX30', 'SHARIAH'],
        marketValue: 6_000,
        weightPercent: 60,
      },
      {
        ticker: 'HRHO',
        instrumentId: idFor('HRHO'),
        assetClass: 'STOCK',
        sector: 'Non-bank Financial Services',
        indices: ['EGX30'],
        marketValue: 3_000,
        weightPercent: 30,
      },
      {
        ticker: 'BMM',
        instrumentId: null,
        assetClass: 'FUND',
        sector: 'Funds (no sector)',
        indices: [],
        marketValue: 1_000,
        weightPercent: 10,
      },
      {
        ticker: 'NOSEC',
        instrumentId: idFor('NOSEC'),
        assetClass: 'STOCK',
        sector: 'Unclassified',
        indices: [],
        marketValue: 0,
        weightPercent: 0,
      },
    ]);
    expect(out.byAssetClass.map((g) => [g.assetClass, g.weightPercent])).toEqual([
      ['STOCK', 90],
      ['FUND', 10],
    ]);
    expect(out.bySector.map((b) => [b.name, b.weightPercent])).toEqual([
      ['Banks', 60],
      ['Non-bank Financial Services', 30],
      ['Funds (no sector)', 10],
      ['Unclassified', 0],
    ]);
    expect(out.byIndex.map((b) => [b.name, b.weightPercent, b.tickers])).toEqual([
      ['EGX30', 90, ['COMI', 'HRHO']],
      ['SHARIAH', 60, ['COMI']],
      ['Not in any index', 10, ['BMM', 'NOSEC']],
    ]);
    expect(out.notes.join(' ')).toMatch(/do not sum to 100%/);
  });

  it('joins by id before ticker, and takes index membership from the matched quote', async () => {
    const { deps } = setup();
    vi.mocked(deps.repository.getAccount).mockResolvedValue({
      summary: createAccountSummary({ ...summary, portfolioValue: 100 }),
      positions: [
        // The id points at COMI although the ticker says HRHO: the id wins.
        position('HRHO', 1, { instrumentId: AssetId.of(idFor('COMI')) }),
        // An id the snapshot does not know: the ticker joins it, and membership follows the quote's id.
        position('COMI', 1, { instrumentId: AssetId.of(idFor('STALE')) }),
      ],
    });
    const out = await new GetPortfolioAllocation(deps).run({});
    expect(out.holdings.map((h) => [h.ticker, h.instrumentId, h.sector, h.indices])).toEqual([
      ['HRHO', idFor('COMI'), 'Banks', ['EGX30', 'SHARIAH']],
      ['COMI', idFor('COMI'), 'Banks', ['EGX30', 'SHARIAH']],
    ]);
  });

  it('handles an empty portfolio for another market', async () => {
    const { deps, md } = setupPortfolio({
      getAccount: vi.fn(async () => ({
        summary: createAccountSummary({ ...summary, portfolioValue: 0 }),
        positions: [],
      })),
    });
    const out = await new GetPortfolioAllocation(deps).run({ market: 'us' });
    expect(md.getMarketQuotes).toHaveBeenCalledWith('us');
    expect(out).toMatchObject({ market: 'us', holdings: [], bySector: [], byIndex: [], basis: 0 });
  });
});
