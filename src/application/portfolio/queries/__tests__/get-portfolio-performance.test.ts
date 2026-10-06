import { describe, expect, it, vi } from 'vitest';
import { setupPortfolio } from '../../../../__tests__/support/fake-portfolio';
import type { ReturnsInterval, ReturnsPoint } from '../../../../domain/portfolio/returns';
import { GetPortfolioPerformance } from '../get-portfolio-performance';

const DAY = 86_400_000;

/** Snapshots every `step` days from `first` to `last` (inclusive), value = 1000 + days since 2024-01-01. */
function series(first: string, last: string, step: number): ReturnsPoint[] {
  const points: ReturnsPoint[] = [];
  const origin = Date.parse('2024-01-01T00:00:00Z');
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += step * DAY) {
    const days = (t - origin) / DAY;
    points.push({
      date: new Date(t),
      portfolioValue: 1_000 + days,
      netDeposits: 1_000,
      totalReturns: days / 10,
    });
  }
  return points.reverse(); // any order: the use case sorts
}

// NOW is 2026-06-01 (Cairo): the latest snapshot is 2026-05-31, like Thndr's 1-day lag.
const daily = series('2025-12-01', '2026-05-31', 1);
const weekly = series('2024-06-06', '2026-05-28', 7);

function setup(charts: Partial<Record<ReturnsInterval, ReturnsPoint[]>> = { '6M': daily, '2Y': weekly }) {
  const getReturnsChart = vi.fn(async (interval: ReturnsInterval) => charts[interval] ?? []);
  return { ...setupPortfolio({ getReturnsChart }), getReturnsChart };
}

describe('GetPortfolioPerformance', () => {
  it('declares its contract', async () => {
    const uc = new GetPortfolioPerformance(setup().deps);
    expect(uc).toMatchObject({ name: 'get_portfolio_performance', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ period: '1M' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('reads the daily 6M and weekly 2Y series once each and reports every period', async () => {
    const { deps, getReturnsChart } = setup();
    const out = await new GetPortfolioPerformance(deps).run({ market: 'egypt' });
    expect(getReturnsChart).toHaveBeenCalledTimes(2);
    expect(getReturnsChart).toHaveBeenCalledWith('6M', 'egypt');
    expect(getReturnsChart).toHaveBeenCalledWith('2Y', 'egypt');
    expect(out).toMatchObject({ market: 'egypt', currency: 'EGP', asOf: new Date('2026-05-31T00:00:00Z') });
    expect(out.series).toEqual([
      {
        interval: '6M',
        granularity: 'daily',
        from: new Date('2025-12-01T00:00:00Z'),
        to: new Date('2026-05-31T00:00:00Z'),
        points: daily.length,
      },
      {
        interval: '2Y',
        granularity: 'weekly',
        from: new Date('2024-06-06T00:00:00Z'),
        to: new Date('2026-05-28T00:00:00Z'),
        points: weekly.length,
      },
    ]);
    const byPeriod = Object.fromEntries(out.periods.map((p) => [p.period, p]));
    expect(Object.keys(byPeriod)).toEqual(['1D', '7D', 'MTD', '1M', '6M', 'YTD', '1Y', '2Y']);
    expect(byPeriod['1D']).toMatchObject({
      requestedFrom: '2026-05-30',
      from: new Date('2026-05-30T00:00:00Z'),
      to: new Date('2026-05-31T00:00:00Z'),
      granularity: 'daily',
      partial: false,
      valueChange: 1,
      netDepositsChange: 0,
      gainExcludingDeposits: 1,
      thndrTotalReturnsChange: 0.1,
    });
    expect(byPeriod['7D']).toMatchObject({ requestedFrom: '2026-05-24', valueChange: 7 });
    // MTD on 1 June: the period has not produced a snapshot yet.
    expect(byPeriod.MTD).toMatchObject({ requestedFrom: '2026-05-31', valueChange: null });
    expect(byPeriod.YTD).toMatchObject({ requestedFrom: '2025-12-31', granularity: 'daily' });
    // The daily series starts 2025-12-01, after the 6M base (2025-11-30): the last weekly point before it is used.
    expect(byPeriod['6M']).toMatchObject({
      requestedFrom: '2025-11-30',
      from: new Date('2025-11-27T00:00:00Z'),
      granularity: 'weekly+daily',
      partial: false,
    });
    expect(byPeriod['1Y']).toMatchObject({ requestedFrom: '2025-05-31', partial: false });
    // The weekly series starts 2024-06-06, after the 2Y base: partial.
    expect(byPeriod['2Y']).toMatchObject({
      requestedFrom: '2024-05-31',
      from: new Date('2024-06-06T00:00:00Z'),
      partial: true,
    });
    const twr = byPeriod['1D']?.timeWeightedReturnPercent ?? 0;
    expect(twr).toBeCloseTo((1 / ((1_000 + 880) as number)) * 100, 3);
    expect(out.method.join(' ')).toMatch(/deposits count from the start of the sub-period/);
  });

  it('reports nulls when Thndr returns no snapshots', async () => {
    const { deps } = setup({});
    const out = await new GetPortfolioPerformance(deps).run({ market: 'us' });
    expect(out).toMatchObject({ market: 'us', currency: 'USD', asOf: null });
    expect(out.series.map((s) => [s.from, s.to, s.points])).toEqual([
      [null, null, 0],
      [null, null, 0],
    ]);
    expect(out.periods.every((p) => p.partial && p.valueChange === null)).toBe(true);
    // Without a snapshot, rolling periods count back from today.
    expect(out.periods[0]?.requestedFrom).toBe('2026-05-31');
  });
});
