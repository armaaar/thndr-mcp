import { describe, expect, it, vi } from 'vitest';
import {
  COMI_ID,
  HRHO_ID,
  setupPortfolio,
  stats,
  UNKNOWN_ID,
} from '../../../../__tests__/support/fake-portfolio';
import { createOverallTradingStats } from '../../../../domain/portfolio/journal';
import { Ticker } from '../../../../domain/shared-kernel/ticker';
import { GetTradingMetrics } from '../get-trading-metrics';

const overall = createOverallTradingStats({
  totalReturn: 1,
  profitFactor: null,
  expectancyPerTrade: null,
  winRatePercent: null,
  averageWin: null,
  averageLoss: null,
  numberOfTrades: null,
  averagePositionSize: null,
  averageDurationDays: null,
});

describe('GetTradingMetrics', () => {
  it('declares its contract and needs no input', async () => {
    const getTradingMetrics = vi.fn(async () => ({ overall, perInstrument: [] }));
    const uc = new GetTradingMetrics(setupPortfolio({ getTradingMetrics }).deps);
    expect(uc).toMatchObject({ name: 'get_trading_metrics', kind: 'query', context: 'portfolio' });
    await expect(uc.run({ symbol: 'COMI' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ to: 'soon' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await uc.run({})).toEqual({ overall, perInstrument: [] });
    expect(getTradingMetrics).toHaveBeenCalledWith({});
  });

  it('converts date-only bounds to Cairo market days', async () => {
    const getTradingMetrics = vi.fn(async () => ({ overall, perInstrument: [] }));
    const { deps } = setupPortfolio({ getTradingMetrics });
    await new GetTradingMetrics(deps).run({ from: '2026-01-01', to: '2026-03-01' });
    expect(getTradingMetrics).toHaveBeenCalledWith({
      from: new Date('2025-12-31T22:00:00.000Z'),
      to: new Date('2026-03-01T21:59:59.999Z'),
    });
  });

  it('enriches per-instrument metrics with tickers and sorts by return', async () => {
    const getTradingMetrics = vi.fn(async () => ({
      overall,
      perInstrument: [
        stats(COMI_ID, 100),
        stats(UNKNOWN_ID, null),
        stats(HRHO_ID, 300),
        stats(null, 50),
        stats(COMI_ID, 10, Ticker.of('KEEP')),
      ],
    }));
    const { deps } = setupPortfolio({ getTradingMetrics });
    const out = await new GetTradingMetrics(deps).execute({ from: '2026-01-01T00:00:00Z' });
    expect(getTradingMetrics).toHaveBeenCalledWith({ from: new Date('2026-01-01T00:00:00Z') });
    expect(out.overall).toBe(overall);
    expect(out.perInstrument.map((s) => [s.ticker?.value ?? null, s.totalReturn])).toEqual([
      ['HRHO', 300],
      ['COMI', 100],
      [null, 50],
      ['KEEP', 10],
      [null, null],
    ]);
  });
});
