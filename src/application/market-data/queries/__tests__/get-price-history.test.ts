import { describe, expect, it } from 'vitest';
import {
  aCandle,
  COMI_ID,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { MAX_HISTORY_MS } from '../../../../domain/market-data/candle';
import { GetPriceHistory } from '../get-price-history';

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
    const out = await new GetPriceHistory(deps).run({ symbol: 'COMI', resolution: '1h', bars: 2 });
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
    const out = await new GetPriceHistory(deps).run({
      symbol: 'COMI',
      resolution: '1h',
      from: '2026-01-14',
      to: '2026-01-14',
      bars: 1,
    });
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
});
