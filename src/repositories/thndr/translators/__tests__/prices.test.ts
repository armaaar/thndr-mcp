import { describe, expect, it } from 'vitest';
import { idFor } from '../../../../__tests__/support/fake-market-data';
import { AssetId } from '../../../../domain/shared-kernel/asset-id';
import { parseGatewayTimestamp, toClosePoints, toLatestPrices, WIRE_CLOSE_OPTION } from '../prices';

const EG = idFor('COMI');
const US = idFor('NVDA');
const AE = idFor('FAB');
const FUND = idFor('BMM');
const FX = idFor('USDEGP');

/** Shaped like the live `securities/v2/price` answer of 2026-10-06 (values synthetic). */
const bulk = {
  day_snapshot: {
    results: [
      {
        asset_id: EG,
        day_snapshot: {
          ask: null,
          bid: null,
          last: {
            close: 125.16,
            market_effective_timestamp: 1791286273092667000,
            open: 126.05,
            previous_close: 126.05,
          },
          rate: null,
        },
      },
      {
        asset_id: US,
        day_snapshot: {
          last: {
            close: 240.1,
            market_effective_timestamp: 1791306900000000000,
            open: 242.1,
            previous_close: 238.9,
          },
        },
      },
      {
        asset_id: AE,
        day_snapshot: {
          last: {
            close: 19.12,
            market_effective_timestamp: '1791301614639906000',
            open: 19.42,
            previous_close: 19.4,
          },
        },
      },
      { asset_id: FX, day_snapshot: { last: null, rate: { previous_close: 49.5 } } },
      { asset_id: FUND, day_snapshot: { last: null, rate: null } },
      { asset_id: 'not-an-id', day_snapshot: { last: { close: 1 } } },
      null,
    ],
  },
  price: {
    results: [
      {
        asset_id: EG,
        price: {
          ask: { value: 125.2 },
          bid: { value: '125.1' },
          last: {
            market_effective_timestamp: 1791286191000000000,
            price_field: 'last_trade_price',
            value: 125.16,
          },
          nav: null,
          rate: null,
        },
      },
      {
        asset_id: US,
        price: {
          last: { market_effective_timestamp: 1791306900000000000, price_field: 'close', value: 240.1 },
        },
      },
      // No price section value: the day snapshot's close is used.
      { asset_id: AE, price: { last: null } },
      { asset_id: FUND, price: { last: null, nav: { value: 12.5, market_effective_timestamp: 1791200000 } } },
      { asset_id: FX, price: { last: { value: null }, rate: { value: 49.9 } } },
      { asset_id: idFor('EMPTY'), price: null },
      null,
      { asset_id: 42 as unknown as string },
    ],
  },
};

describe('price translators', () => {
  it('maps every close span to its chart option', () => {
    expect(Object.values(WIRE_CLOSE_OPTION)).toEqual(['1d', '1w', '1M', '6M', '1y', '2y', 'all']);
  });

  it('reads nanosecond, second, millisecond and ISO timestamps', () => {
    expect(parseGatewayTimestamp(1791306900000000000)?.toISOString()).toBe('2026-10-06T17:15:00.000Z');
    expect(parseGatewayTimestamp('1791306900000000000')?.toISOString()).toBe('2026-10-06T17:15:00.000Z');
    expect(parseGatewayTimestamp(1791306900)?.toISOString()).toBe('2026-10-06T17:15:00.000Z');
    expect(parseGatewayTimestamp('2026-10-06T17:15:00Z')?.toISOString()).toBe('2026-10-06T17:15:00.000Z');
    expect(parseGatewayTimestamp(null)).toBeNull();
    // Microseconds are not mistaken for nanoseconds.
    expect(parseGatewayTimestamp(1791306900000000)?.getUTCFullYear()).toBeGreaterThan(2026);
  });

  it('joins the price and day-snapshot sections per asset', () => {
    const out = new Map(toLatestPrices(bulk).map((p) => [p.instrumentId.value, p]));
    expect([...out.keys()].sort()).toEqual([EG, US, AE, FUND, FX].sort());
    expect(out.get(EG)).toMatchObject({
      last: 125.16,
      kind: 'trade',
      open: 126.05,
      previousClose: 126.05,
      bid: 125.1,
      ask: 125.2,
      at: new Date('2026-10-06T11:29:51.000Z'),
    });
    expect(out.get(US)).toMatchObject({
      last: 240.1,
      kind: 'close',
      previousClose: 238.9,
      bid: null,
      ask: null,
    });
    expect(out.get(AE)).toMatchObject({
      last: 19.12,
      kind: 'close',
      open: 19.42,
      at: new Date(Math.floor(1791301614639906000 / 1e6)),
    });
    expect(out.get(FUND)).toMatchObject({ last: 12.5, kind: 'nav', previousClose: null, open: null });
    expect(out.get(FX)).toMatchObject({ last: 49.9, kind: 'rate', previousClose: 49.5 });
  });

  it('tolerates missing sections and unknown price fields', () => {
    expect(toLatestPrices(null)).toEqual([]);
    expect(toLatestPrices({ price: { results: null } })).toEqual([]);
    const [only] = toLatestPrices({
      price: { results: [{ asset_id: US, price: { last: { value: 1, price_field: 'mid' } } }] },
    });
    expect(only).toMatchObject({ last: 1, kind: 'unknown', at: null, open: null, previousClose: null });
  });

  it('maps a chart series to sorted close points, dropping bad rows', () => {
    const id = AssetId.of(US);
    const points = toClosePoints(
      {
        [US]: {
          '2026-10-06T04:00:00Z': 239.93,
          '2026-09-08T04:00:00Z': '225.73',
          'not a date': 1,
          '2026-09-09T04:00:00Z': null,
          '2026-09-10T04:00:00Z': 0,
        },
        [EG]: { '2026-10-06T07:00:00.000Z': 126.87 },
      },
      id,
    );
    expect(points).toEqual([
      { time: new Date('2026-09-08T04:00:00Z'), close: 225.73 },
      { time: new Date('2026-10-06T04:00:00Z'), close: 239.93 },
    ]);
    expect(toClosePoints({}, id)).toEqual([]);
    expect(toClosePoints(null, id)).toEqual([]);
    expect(toClosePoints({ [US]: null }, id)).toEqual([]);
  });
});
