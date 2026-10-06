import { describe, expect, it } from 'vitest';
import {
  aCandle,
  COMI_ID,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { NotAuthenticatedError, NotFoundError, UpstreamError } from '../../../errors';
import { GetPricePerformance } from '../get-price-performance';

const NOW = new Date('2026-10-06T12:00:00Z');
const c = (day: string, close: number, high = close, low = close) =>
  aCandle({ time: new Date(`${day}T00:00:00Z`), open: close, high, low, close });

function setup() {
  return setupMarketData(withInstruments('COMI'), NOW);
}

describe('GetPricePerformance', () => {
  it('declares its contract', async () => {
    const uc = new GetPricePerformance(setup());
    expect(uc).toMatchObject({ name: 'get_price_performance', kind: 'query', context: 'market-data' });
    for (const input of [{}, { symbol: 'COMI', market: 'mars' }, { symbol: 'COMI', period: '1Y' }]) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('fetches ~5 years of daily candles and Thndr’s yearly return, and rounds the figures', async () => {
    const deps = setup();
    deps.repository.candles = [
      c('2025-10-01', 80.123456, 81, 79),
      c('2026-09-29', 110.00004, 111.987654, 100.5),
      c('2026-10-06', 121.333333, 122, 120),
    ];
    deps.research.yearlyReturns[COMI_ID] = { percent: 30.01, direction: 'gain' };
    const out = await new GetPricePerformance(deps).run({ symbol: 'COMI' });

    const call = deps.repository.calls.getCandles[0]!;
    expect(call).toMatchObject({ resolution: '1d', to: NOW, from: new Date('2021-09-26T12:00:00Z') });
    expect(call.id.value).toBe(COMI_ID);
    expect(deps.research.calls.getYearlyReturn.map((id) => id.value)).toEqual([COMI_ID]);

    expect(out).toMatchObject({
      ticker: 'COMI',
      name: 'COMI Corp',
      currency: 'EGP',
      asOf: '2026-10-06',
      lastClose: 121.3333,
      thndrOneYearReturn: { percent: 30.01, direction: 'gain' },
      history: { firstDate: '2025-10-01', sessions: 3, resolution: '1d' },
      week52: { high: 122, highDate: '2026-10-06', low: 100.5, lowDate: '2026-09-29' },
      maxDrawdown1Y: { percent: 0, peakDate: '2025-10-01', troughDate: '2025-10-01' },
    });
    expect(out.returns.find((r) => r.period === '1W')).toEqual({
      period: '1W',
      startDate: '2026-09-29',
      baseDate: '2026-09-29',
      baseClose: 110,
      returnPercent: 10.3,
    });
    expect(out.returns.find((r) => r.period === '1Y')).toMatchObject({
      baseClose: 80.1235,
      returnPercent: 51.43,
    });
    expect(out.returns.find((r) => r.period === '5Y')?.returnPercent).toBeNull();
    expect(out.volatility.every((v) => v.annualisedPercent === null)).toBe(true);
    expect(out.method).toContain('√252');
  });

  it('answers with empty statistics when Thndr has no candles', async () => {
    const out = await new GetPricePerformance(setup()).run({ symbol: 'COMI' });
    expect(out).toMatchObject({
      asOf: null,
      lastClose: null,
      returns: [],
      week52: null,
      maxDrawdown1Y: null,
      thndrOneYearReturn: null,
    });
  });

  it('answers without Thndr’s one-year return, with a note, when that call fails', async () => {
    const deps = setup();
    deps.repository.candles = [c('2026-10-05', 10), c('2026-10-06', 11)];
    deps.research.failures.getYearlyReturn = new UpstreamError('Thndr API error 503 on GET /assets', 503);
    const out = await new GetPricePerformance(deps).run({ symbol: 'COMI' });
    expect(out).toMatchObject({ lastClose: 11, thndrOneYearReturn: null });
    expect(out.notes).toEqual([expect.stringContaining('503')]);

    deps.research.failures.getYearlyReturn = new NotFoundError('Asset not found');
    expect((await new GetPricePerformance(deps).run({ symbol: 'COMI' })).thndrOneYearReturn).toBeNull();

    deps.research.failures.getYearlyReturn = new NotAuthenticatedError();
    await expect(new GetPricePerformance(deps).run({ symbol: 'COMI' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
  });

  it('documents the forward base for history that starts just after the 5Y start', async () => {
    const deps = setup();
    deps.repository.candles = [c('2021-10-10', 50), c('2026-10-06', 75)];
    const out = await new GetPricePerformance(deps).run({ symbol: 'COMI' });
    expect(out.returns.find((r) => r.period === '5Y')).toMatchObject({
      startDate: '2021-10-06',
      baseDate: '2021-10-10',
      returnPercent: 50,
    });
    expect(out.method).toContain('7 days after the start');
    expect(out.notes).toBeUndefined();
  });

  it('rounds the volatility and a drawdown', async () => {
    const deps = setup();
    deps.repository.candles = Array.from({ length: 40 }, (_, i) =>
      c(new Date(Date.UTC(2026, 7, 28 + i)).toISOString().slice(0, 10), i % 2 === 0 ? 100 : 90.5),
    );
    const out = await new GetPricePerformance(deps).run({ symbol: 'COMI' });
    const vol = out.volatility[0]?.annualisedPercent as number;
    expect(vol).toBe(Math.round(vol * 100) / 100);
    expect(out.maxDrawdown1Y?.percent).toBe(-9.5);
  });
});
