import { describe, expect, it } from 'vitest';
import {
  aCandle,
  anInstrument,
  aUsInstrument,
  COMI_ID,
  closes,
  FakeMarketDataRepository,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { MAX_HISTORY_MS } from '../../../../domain/market-data/candle';
import { type CandleHistory, type CloseHistory, GetPriceHistory } from '../get-price-history';

const NOW = new Date('2026-01-15T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const candlesAt = (...hours: number[]) =>
  hours.map((h) => aCandle({ time: new Date(Date.UTC(2026, 0, 15, h)), close: h }));

function setup() {
  return setupMarketData(withInstruments('COMI'), NOW);
}

describe('GetPriceHistory', () => {
  it('declares its contract', async () => {
    const uc = new GetPriceHistory(setup());
    expect(uc).toMatchObject({ name: 'get_price_history', kind: 'query', context: 'market-data' });
    const invalid = [
      {},
      { symbol: 'COMI', resolution: '2h' },
      { symbol: 'COMI', bars: 0 },
      { symbol: 'COMI', bars: 2001 },
      { symbol: 'COMI', from: 'not-a-date' },
      { symbol: 'COMI', to: 'yesterday' },
      { symbol: 'COMI', interval: '1d' },
      { symbol: 'COMI', market: 'mars' },
    ];
    for (const input of invalid) {
      await expect(uc.run(input), JSON.stringify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('applies defaults via run(): daily bars, 100 bars with a 1.6x window, up to now', async () => {
    const deps = setup();
    const out = await new GetPriceHistory(deps).run({ symbol: 'COMI' });
    const call = deps.repository.calls.getCandles[0]!;
    expect(call.resolution).toBe('1d');
    expect(call.id.value).toBe(COMI_ID);
    expect(call.to).toEqual(NOW);
    expect(call.from).toEqual(new Date(NOW.getTime() - 100 * DAY * 1.6));
    expect(out).toEqual({
      kind: 'candles',
      market: 'egypt',
      ticker: 'COMI',
      resolution: '1d',
      from: call.from.toISOString(),
      to: NOW.toISOString(),
      candles: [],
    });
  });

  it('over-fetches 4x for intraday bars, sorts and trims to the requested bar count', async () => {
    const deps = setup();
    deps.repository.candles = candlesAt(11, 9, 10);
    const out = (await new GetPriceHistory(deps).run({
      symbol: 'COMI',
      resolution: '1h',
      bars: 2,
    })) as CandleHistory;
    expect(deps.repository.calls.getCandles[0]!.from).toEqual(new Date(NOW.getTime() - 2 * HOUR * 4));
    expect(out.candles.map((c) => c.close)).toEqual([10, 11]);
  });

  it('uses 4x for minute bars and clamps to 5 years of history', async () => {
    const deps = setup();
    const uc = new GetPriceHistory(deps);
    await uc.run({ symbol: 'COMI', resolution: '5min', bars: 1 });
    expect(deps.repository.calls.getCandles[0]!.from).toEqual(new Date(NOW.getTime() - 300_000 * 4));
    await uc.run({ symbol: 'COMI', resolution: '1w', bars: 2000 });
    expect(deps.repository.calls.getCandles[1]!.from).toEqual(new Date(NOW.getTime() - MAX_HISTORY_MS));
  });

  it('defaults and clamps bars and resolution when executed directly', async () => {
    const deps = setup();
    const uc = new GetPriceHistory(deps);
    await uc.execute({ symbol: 'COMI' });
    expect(deps.repository.calls.getCandles[0]).toMatchObject({
      resolution: '1d',
      from: new Date(NOW.getTime() - 100 * DAY * 1.6),
    });
    await uc.execute({ symbol: 'COMI', resolution: '1min', bars: 0 });
    expect(deps.repository.calls.getCandles[1]!.from).toEqual(new Date(NOW.getTime() - 60_000 * 4));
    await uc.execute({ symbol: 'COMI', resolution: '1h', bars: 10_000 });
    expect(deps.repository.calls.getCandles[2]!.from).toEqual(new Date(NOW.getTime() - 2000 * HOUR * 4));
  });

  it('treats date-only bounds as Cairo market days and returns every candle in the window', async () => {
    const deps = setup();
    deps.repository.candles = candlesAt(10, 9, 11);
    const out = (await new GetPriceHistory(deps).run({
      symbol: 'COMI',
      resolution: '1h',
      from: '2026-01-14',
      to: '2026-01-14',
      bars: 1,
    })) as CandleHistory;
    // Cairo is UTC+2 in January: the 14th runs from 13th 22:00Z to 14th 21:59:59.999Z.
    expect(deps.repository.calls.getCandles[0]).toMatchObject({
      from: new Date('2026-01-13T22:00:00.000Z'),
      to: new Date('2026-01-14T21:59:59.999Z'),
    });
    expect(out).toMatchObject({ from: '2026-01-13T22:00:00.000Z', to: '2026-01-14T21:59:59.999Z' });
    expect(out.candles.map((c) => c.close)).toEqual([9, 10, 11]);
  });

  it('takes datetimes as given and caps "to" at now', async () => {
    const deps = setup();
    await new GetPriceHistory(deps).run({
      symbol: 'COMI',
      from: '2026-01-15T10:00:00+02:00',
      to: '2026-02-01T00:00:00Z',
    });
    expect(deps.repository.calls.getCandles[0]).toMatchObject({
      from: new Date('2026-01-15T08:00:00Z'),
      to: NOW,
    });
  });

  it('derives "from" from an explicit "to"', async () => {
    const deps = setup();
    await new GetPriceHistory(deps).run({ symbol: 'COMI', to: '2026-01-10T00:00:00Z', bars: 10 });
    const to = new Date('2026-01-10T00:00:00Z');
    expect(deps.repository.calls.getCandles[0]).toMatchObject({
      from: new Date(to.getTime() - 16 * DAY),
      to,
    });
  });

  it('rejects an unparseable date when executed directly', async () => {
    await expect(
      new GetPriceHistory(setup()).execute({ symbol: 'COMI', from: 'garbage' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  describe('outside Egypt (closing prices only)', () => {
    const daily = closes(
      ['2026-01-09T04:00:00Z', 10],
      ['2026-01-12T04:00:00Z', 11],
      ['2026-01-13T04:00:00Z', 12],
      ['2026-01-14T04:00:00Z', 13],
      ['2026-01-15T04:00:00Z', 14],
    );

    function setupForeign(...instruments: ReturnType<typeof anInstrument>[]) {
      const repository = new FakeMarketDataRepository({ instruments });
      return setupMarketData(repository, NOW);
    }

    it('serves the latest N closes of the span covering the window, never candles', async () => {
      const deps = setupForeign(aUsInstrument());
      deps.repository.closeSeries['6M'] = daily;
      const out = (await new GetPriceHistory(deps).run({
        symbol: 'NVDA',
        market: 'us',
        bars: 3,
      })) as CloseHistory;
      expect(deps.repository.calls.getCandles).toEqual([]);
      // 3 daily bars × 1.6 = 4.8 days → the 1w span; the fake serves 6M only, so ask with the default bars too.
      expect(deps.repository.calls.getCloses.map((c) => [c.market, c.span])).toEqual([['us', '1w']]);
      expect(out).toMatchObject({ kind: 'closes', market: 'us', ticker: 'NVDA', points: [] });

      const full = (await new GetPriceHistory(deps).run({ symbol: 'NVDA', market: 'us' })) as CloseHistory;
      expect(deps.repository.calls.getCloses[1]).toMatchObject({ span: '6M', market: 'us' });
      expect(full).toMatchObject({
        kind: 'closes',
        requestedResolution: '1d',
        span: '6M',
        granularity: 'daily',
        to: NOW.toISOString(),
      });
      expect(full.points.map((p) => p.close)).toEqual([10, 11, 12, 13, 14]);
      expect(full.note).toMatch(/Closing prices only/);
      expect(full).not.toHaveProperty('candles');
    });

    it('keeps the latest bars up to "to", reporting the first point as "from" when the span starts earlier', async () => {
      const deps = setupForeign(aUsInstrument());
      deps.repository.closeSeries['1d'] = daily;
      const out = (await new GetPriceHistory(deps).run({
        symbol: 'NVDA',
        market: 'us',
        resolution: '1min',
        bars: 2,
      })) as CloseHistory;
      expect(out.span).toBe('1d');
      expect(out.points.map((p) => p.close)).toEqual([13, 14]);
      expect(out.from).toBe('2026-01-14T04:00:00.000Z');
    });

    it('keeps only the points inside an explicit range, with the span reaching its start', async () => {
      const deps = setupForeign(anInstrument({ ticker: 'FAB', market: 'uae', currency: 'AED' }));
      deps.repository.closeSeries['1w'] = daily;
      const out = (await new GetPriceHistory(deps).run({
        symbol: 'FAB',
        market: 'uae',
        from: '2026-01-10',
        to: '2026-01-13',
      })) as CloseHistory;
      expect(deps.repository.calls.getCloses[0]).toMatchObject({ market: 'uae', span: '1w' });
      expect(out.points.map((p) => p.close)).toEqual([11, 12]);
      expect(out.from).toBe('2026-01-09T22:00:00.000Z');
      deps.repository.closeSeries['1M'] = daily;
      await new GetPriceHistory(deps).run({ symbol: 'FAB', market: 'uae', from: '2026-01-01' });
      expect(deps.repository.calls.getCloses[1]).toMatchObject({ span: '1M' });
    });

    it('follows the instrument’s own market for a simulator symbol', async () => {
      const deps = setupForeign(aUsInstrument({ market: 'us' }), anInstrument({ ticker: 'COMI' }));
      deps.repository.searchInstruments = async () => [aUsInstrument()];
      await new GetPriceHistory(deps).run({ symbol: 'NVDA', market: 'simulator' });
      expect(deps.repository.calls.getCloses[0]).toMatchObject({ market: 'us' });
      deps.repository.searchInstruments = async () => [anInstrument({ ticker: 'COMI' })];
      const egypt = await new GetPriceHistory(deps).run({ symbol: 'COMI', market: 'simulator' });
      expect(egypt.kind).toBe('candles');
      expect(deps.repository.calls.getCandles).toHaveLength(1);
    });
  });
});
