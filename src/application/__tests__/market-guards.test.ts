import { describe, expect, it } from 'vitest';
import { engagementSetup } from '../../__tests__/support/fake-engagement';
import {
  anInstrument,
  COMI_ID,
  FakeMarketDataRepository,
  setupMarketData,
} from '../../__tests__/support/fake-market-data';
import { setupPortfolio } from '../../__tests__/support/fake-portfolio';
import { CreateAlert } from '../engagement/commands/create-alert';
import { CreateWatchlist } from '../engagement/commands/create-watchlist';
import { UpdateAlert } from '../engagement/commands/update-alert';
import { GetAlert } from '../engagement/queries/get-alert';
import { GetAlerts } from '../engagement/queries/get-alerts';
import { GetWatchlists } from '../engagement/queries/get-watchlists';
import { GetFinancials } from '../market-data/queries/get-financials';
import { GetIndexConstituents } from '../market-data/queries/get-index-constituents';
import { GetMarketDepth } from '../market-data/queries/get-market-depth';
import { GetMarketStatus } from '../market-data/queries/get-market-status';
import { GetRecentTrades } from '../market-data/queries/get-recent-trades';
import { ScreenMarket } from '../market-data/queries/screen-market';
import { GetClosedTrades } from '../portfolio/queries/get-closed-trades';
import { GetPortfolioPerformance } from '../portfolio/queries/get-portfolio-performance';
import { GetRealizedReturns } from '../portfolio/queries/get-realized-returns';
import { GetTradingMetrics } from '../portfolio/queries/get-trading-metrics';
import { ListAccountActivity } from '../portfolio/queries/list-account-activity';
import type { UseCase } from '../use-case';

const NVDA_ID = '4ce9353c-66d1-46c2-898f-fce867ab0247';

/** Market Data fakes listing an Egyptian COMI and a US NVDA. */
function marketData() {
  const repository = new FakeMarketDataRepository({
    instruments: [
      anInstrument({ ticker: 'COMI' }),
      anInstrument({ ticker: 'NVDA', id: NVDA_ID, market: 'us' }),
    ],
  });
  return setupMarketData(repository);
}

function calls(repository: { calls: object }, except: string[] = []): number {
  return Object.entries(repository.calls)
    .filter(([name, list]) => !except.includes(name) && Array.isArray(list))
    .reduce((sum, [, list]) => sum + (list as unknown[]).length, 0);
}

async function expectDisabled(useCase: UseCase, input: Record<string, unknown>) {
  await expect(useCase.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
}

describe('per-market guards fail before calling Thndr', () => {
  it('Market Data tools that need the market or the instrument’s market to offer a feature', async () => {
    const deps = marketData();
    await expectDisabled(new ScreenMarket(deps), { market: 'us' });
    await expectDisabled(new GetIndexConstituents(deps), { market: 'uae' });
    await expectDisabled(new GetMarketStatus(deps), { market: 'simulator' });
    expect(calls(deps.repository)).toBe(0);
    // Depth, trades and financials check the instrument's market (resolving it is the only call).
    await expectDisabled(new GetMarketDepth(deps), { symbol: NVDA_ID, market: 'us' });
    await expectDisabled(new GetRecentTrades(deps), { symbol: NVDA_ID });
    await expectDisabled(new GetFinancials(deps), { symbol: NVDA_ID });
    expect(calls(deps.repository, ['getInstrument'])).toBe(0);
    expect(deps.research.calls.getFinancials).toEqual([]);
  });

  it('an Egyptian instrument keeps Egypt’s features for a simulator user', async () => {
    const deps = marketData();
    const depth = await new GetMarketDepth(deps).run({ symbol: COMI_ID, market: 'simulator' });
    expect(depth).toMatchObject({ ticker: 'COMI' });
    expect(deps.repository.calls.getOrderBook).toHaveLength(1);
  });

  it('Portfolio tools', async () => {
    const { deps, repository } = setupPortfolio();
    await expectDisabled(new ListAccountActivity(deps), { market: 'simulator' });
    await expectDisabled(new GetRealizedReturns(deps), { market: 'simulator' });
    await expectDisabled(new GetPortfolioPerformance(deps), { market: 'simulator' });
    await expectDisabled(new GetTradingMetrics(deps), { market: 'us' });
    await expectDisabled(new GetClosedTrades(deps), { market: 'uae' });
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it('Engagement tools', async () => {
    const deps = engagementSetup();
    await expectDisabled(new GetAlerts(deps), { market: 'uae' });
    await expectDisabled(new GetAlert(deps), { id: '1', market: 'uae' });
    await expectDisabled(new CreateAlert(deps), { symbol: 'COMI', price: 10, market: 'uae' });
    await expectDisabled(new UpdateAlert(deps), { id: '1', price: 10, market: 'uae' });
    await expectDisabled(new GetWatchlists(deps), { market: 'simulator' });
    await expectDisabled(new CreateWatchlist(deps), { name: 'Paper', market: 'simulator' });
    expect(calls(deps.repository)).toBe(0);
    expect(calls(deps.market)).toBe(0);
  });
});
