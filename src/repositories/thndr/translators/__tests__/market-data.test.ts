import { describe, expect, it } from 'vitest';
import type { MarketwatchAssetDto } from '../../../../data-sources/thndr/dto/market-data';
import {
  indicatorToQuote,
  mapCurrency,
  mapRows,
  parseAssetIdOrNull,
  parseTickerOrNull,
  sanitizeTicker,
  toCandle,
  toConstituentIds,
  toInstrument,
  toOrderBook,
  toQuote,
  toTapeTrade,
  WIRE_RESOLUTION,
} from '../market-data';

const ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';

describe('WIRE_RESOLUTION', () => {
  it('maps domain resolutions to API granularities', () => {
    expect(WIRE_RESOLUTION).toEqual({
      '1min': '1MIN',
      '5min': '5MIN',
      '10min': '10MIN',
      '1h': '1HR',
      '1d': '1D',
      '1w': '1W',
    });
  });
});

describe('mapCurrency', () => {
  it.each([
    [1, 'EGP'],
    ['1', 'EGP'],
    [2, 'USD'],
    ['2', 'USD'],
    ['egp', 'EGP'],
    ['USD', 'USD'],
    [0, null],
    ['points', null],
    ['GBP', null],
    [null, null],
    [undefined, null],
  ])('%s → %s', (raw, expected) => {
    expect(mapCurrency(raw)).toBe(expected);
  });
});

describe('id and ticker parsing', () => {
  it('parses or returns null', () => {
    expect(parseAssetIdOrNull(ID.toUpperCase())?.value).toBe(ID);
    expect(parseAssetIdOrNull('nope')).toBeNull();
    expect(parseAssetIdOrNull(5)).toBeNull();
    expect(parseTickerOrNull('comi')?.value).toBe('COMI');
    expect(parseTickerOrNull('USD/EGP')).toBeNull();
    expect(parseTickerOrNull(undefined)).toBeNull();
  });

  it.each([
    ['COMI', 'COMI'],
    ['USD/EGP', 'USD-EGP'],
    ['EGX70 EWI', 'EGX70-EWI'],
    [' /egx30', 'EGX30'],
    ['EGX100 EWI CAPPED LONG', 'EGX100-EWI-CAPP'],
  ])('sanitises %s → %s', (raw, expected) => {
    expect(sanitizeTicker(raw)?.value).toBe(expected);
  });

  it('gives up when nothing usable remains', () => {
    expect(sanitizeTicker('///')).toBeNull();
    expect(sanitizeTicker('')).toBeNull();
    expect(sanitizeTicker(null)).toBeNull();
  });
});

describe('toInstrument', () => {
  it('maps a full asset-details payload', () => {
    const instrument = toInstrument(
      {
        id: ID,
        symbol: 'comi',
        name: 'Commercial International Bank',
        asset_class: 'STOCK',
        market: 'egypt',
        currency: 1,
        round_digits: 3,
        is_3dp: false,
        is_tradable: true,
        logo: 'https://cdn/comi.png',
        industry: 'Banks',
        sector: 'ignored',
        about: 'A bank',
        stats: { symbol_state: 'S' },
        feed: { market_id: 'NOPL' },
      },
      'us',
    );
    expect(instrument).toEqual({
      id: expect.objectContaining({ value: ID }),
      ticker: expect.objectContaining({ value: 'COMI' }),
      name: 'Commercial International Bank',
      assetClass: 'STOCK',
      market: 'egypt',
      currency: 'EGP',
      sector: 'Banks',
      board: 'NOPL',
      tradable: true,
      suspended: true,
      priceDecimals: 3,
      description: 'A bank',
      logoUrl: 'https://cdn/comi.png',
    });
    expect(Object.isFrozen(instrument)).toBe(true);
  });

  it('keeps visible tag names once, in order, and omits tags when Thndr sends none', () => {
    const tagged = toInstrument(
      {
        id: ID,
        symbol: 'COMI',
        tags: [
          { id: 186, slug: 'Banks', name: 'Banks' },
          { id: 1, slug: 'EGX30', name: ' EGX30 ' },
          { id: 2, slug: 'secret', name: 'Secret', hidden: true },
          { id: 3, slug: 'sharia', name: null },
          { id: 4, slug: 'Banks', name: 'Banks' },
          { id: 5 },
          null as unknown as { id: number },
        ],
      },
      'egypt',
    );
    expect(tagged?.tags).toEqual(['Banks', 'EGX30', 'sharia']);
    expect(Object.isFrozen(tagged?.tags)).toBe(true);
    expect(toInstrument({ id: ID, symbol: 'COMI' }, 'egypt')).not.toHaveProperty('tags');
  });

  it('maps unknown or missing fields to null/defaults', () => {
    expect(
      toInstrument(
        { id: ID, symbol: 'COMI', market: 'adsm', name: ' ', is_tradable: 'yes' as unknown as boolean },
        'us',
      ),
    ).toEqual({
      id: expect.anything(),
      ticker: expect.anything(),
      name: 'COMI',
      assetClass: 'UNKNOWN',
      market: 'us',
      currency: null,
      sector: null,
      board: null,
      tradable: null,
      suspended: false,
      priceDecimals: null,
      description: null,
      logoUrl: null,
    });
  });

  it('derives price decimals from is_3dp when round_digits is unusable', () => {
    const decimals = (extra: object) =>
      toInstrument({ id: ID, symbol: 'COMI', ...extra }, 'egypt')?.priceDecimals;
    expect(decimals({ round_digits: -1, is_3dp: true })).toBe(3);
    expect(decimals({ round_digits: 2.5, is_3dp: false })).toBe(2);
    expect(decimals({ round_digits: '2' })).toBe(2);
  });

  it('reads sector and suspension from fallback fields', () => {
    const instrument = toInstrument(
      { id: ID, symbol: 'COMI', sector: 'Banks', symbol_state: 'S', stats: null },
      'egypt',
    );
    expect(instrument).toMatchObject({ sector: 'Banks', suspended: true });
  });

  it('rejects rows without a valid id or ticker', () => {
    expect(toInstrument(null, 'egypt')).toBeNull();
    expect(toInstrument('x' as never, 'egypt')).toBeNull();
    expect(toInstrument({ symbol: 'COMI' }, 'egypt')).toBeNull();
    expect(toInstrument({ id: ID }, 'egypt')).toBeNull();
    expect(toInstrument({ id: ID, symbol: 'USD/EGP' }, 'egypt')).toBeNull();
  });

  it('sanitises the ticker on request', () => {
    expect(toInstrument({ id: ID, symbol: 'USD/EGP' }, 'egypt', { sanitizeTicker: true })?.ticker.value).toBe(
      'USD-EGP',
    );
  });
});

describe('toQuote', () => {
  const row: MarketwatchAssetDto = {
    asset_id: ID,
    reuters: 'COMI',
    eng_name: 'CIB',
    eng_desc: 'Banks',
    currency: 1,
    symbol_state: 'A',
    last_trade_price: '80.5',
    close_price: 80,
    previous_close: 79,
    open_price: 79.5,
    last_change: 1.5,
    last_change_prc: 1.9,
    high_price: 81,
    low_price: 79.1,
    last_trade_date: '2026-01-15T12:29:00Z',
    bid_price: 80.4,
    bid_volume: 1000,
    ask_price: 80.6,
    ask_volume: 2000,
    listed_shares: 1000,
    pe_ratio: 7.5,
    eps: 10.7,
    dividend_yield_perc: 2.5,
    total_value: 1_000_000,
    total_volume: 12_500,
    total_trades: 340,
    high_price_limit: 88,
    low_price_limit: 72,
    max_limit: 999,
    min_limit: 1,
    avg_30_day: 10_000,
    high_52_week: 95,
    low_52_week: 60,
    market_id: 'NOPL',
  };

  it('maps a marketwatch row', () => {
    const quote = toQuote(row);
    expect(quote).toEqual({
      instrumentId: expect.objectContaining({ value: ID }),
      ticker: expect.objectContaining({ value: 'COMI' }),
      name: 'CIB',
      sector: 'Banks',
      board: 'NOPL',
      currency: 'EGP',
      last: 80.5,
      previousClose: 79,
      open: 79.5,
      high: 81,
      low: 79.1,
      change: 1.5,
      changePercent: 1.9,
      bid: 80.4,
      bidSize: 1000,
      ask: 80.6,
      askSize: 2000,
      volume: 12_500,
      value: 1_000_000,
      trades: 340,
      lowerLimit: 72,
      upperLimit: 88,
      week52High: 95,
      week52Low: 60,
      peRatio: 7.5,
      eps: 10.7,
      dividendYieldPercent: 2.5,
      listedShares: 1000,
      marketCap: 80_500,
      averageVolume30d: 10_000,
      suspended: false,
      lastTradeAt: new Date('2026-01-15T12:29:00Z'),
    });
    expect(Object.isFrozen(quote)).toBe(true);
  });

  it('keeps index rows by sanitising their symbol, and treats a blank sector as unknown', () => {
    expect(toQuote({ ...row, reuters: 'EGX70 EWI', market_id: 'INDX', eng_desc: ' ' })).toMatchObject({
      ticker: expect.objectContaining({ value: 'EGX70-EWI' }),
      board: 'INDX',
      sector: null,
    });
    expect(toQuote({ ...row, reuters: 'EGX70 EWI' })).toBeNull();
  });

  it('falls back to close price, computes change, and uses min/max limits', () => {
    const quote = toQuote({
      ...row,
      last_trade_price: 0,
      last_change: null,
      high_price_limit: undefined,
      low_price_limit: undefined,
      currency: 2,
      symbol_state: 'S',
    });
    expect(quote).toMatchObject({
      last: 80,
      change: 1,
      marketCap: 80_000,
      lowerLimit: 1,
      upperLimit: 999,
      currency: 'USD',
      suspended: true,
    });
  });

  it('maps an almost empty row to nulls', () => {
    const quote = toQuote({ asset_id: ID, reuters: 'COMI', currency: 0 });
    expect(quote).toMatchObject({
      name: null,
      sector: null,
      currency: null,
      last: null,
      change: null,
      marketCap: null,
      listedShares: null,
      lastTradeAt: null,
      suspended: false,
    });
    expect(toQuote({ asset_id: ID, reuters: 'COMI', last_trade_price: 5 })).toMatchObject({
      change: null,
      marketCap: null,
    });
  });

  it('rejects rows without a valid id or ticker', () => {
    expect(toQuote(undefined)).toBeNull();
    expect(toQuote({ reuters: 'COMI' })).toBeNull();
    expect(toQuote({ asset_id: ID, reuters: 'BAD TICKER' })).toBeNull();
  });
});

describe('toConstituentIds', () => {
  it('maps valid member ids and skips the rest', () => {
    const ids = toConstituentIds({
      constituents: [{ id: ID }, { id: 'not-a-uuid' }, {}, null as unknown as { id: string }],
    });
    expect(ids.map((id) => id.value)).toEqual([ID]);
    expect(toConstituentIds({ id: ID })).toEqual([]);
    expect(toConstituentIds(null)).toEqual([]);
  });
});

describe('indicatorToQuote', () => {
  it('uses last_trade_price when positive and sanitises the symbol', () => {
    const quote = indicatorToQuote({
      id: ID,
      symbol: 'EGX70 EWI',
      name: 'EGX 70 EWI',
      feed: { price: 1, last_trade_price: '9000.5', last_change_prc: -0.4, previous_close: 9036 },
    });
    expect(quote).toMatchObject({
      ticker: expect.objectContaining({ value: 'EGX70-EWI' }),
      name: 'EGX 70 EWI',
      last: 9000.5,
      changePercent: -0.4,
      previousClose: 9036,
      board: null,
      currency: null,
      volume: null,
      suspended: false,
      lastTradeAt: null,
    });
  });

  it('falls back to price, tolerates a missing feed and rejects invalid rows', () => {
    expect(
      indicatorToQuote({ id: ID, symbol: 'USD/EGP', feed: { price: 50.1, last_trade_price: 0 } })?.last,
    ).toBe(50.1);
    expect(indicatorToQuote({ id: ID, symbol: 'EGX30' })).toMatchObject({
      last: null,
      name: null,
      previousClose: null,
    });
    expect(indicatorToQuote(null)).toBeNull();
    expect(indicatorToQuote({ id: 'x', symbol: 'EGX30' })).toBeNull();
    expect(indicatorToQuote({ id: ID, symbol: '***' })).toBeNull();
  });
});

describe('toCandle', () => {
  it('coerces decimal strings to numbers', () => {
    expect(
      toCandle({
        timestamp: '2026-01-15T10:00:00Z',
        open: '10.5',
        high: '11',
        low: '10',
        close: 10.8,
        volume: '1,200',
      }),
    ).toEqual({
      time: new Date('2026-01-15T10:00:00Z'),
      open: 10.5,
      high: 11,
      low: 10,
      close: 10.8,
      volume: 1200,
    });
  });

  it('rejects malformed rows', () => {
    const good = { timestamp: '2026-01-15T10:00:00Z', open: 1, high: 2, low: 1, close: 2, volume: 3 };
    expect(toCandle(null)).toBeNull();
    expect(toCandle({ ...good, timestamp: 'garbage' })).toBeNull();
    for (const key of ['open', 'high', 'low', 'close', 'volume'] as const) {
      expect(toCandle({ ...good, [key]: null })).toBeNull();
    }
    expect(toCandle({ ...good, high: 0.5 })).toBeNull();
  });
});

describe('toOrderBook', () => {
  it('sorts bids descending, asks ascending and skips invalid levels', () => {
    const book = toOrderBook({
      bids_per_price: [
        { order_price: 9.8, volume_traded: 100, split: 2 },
        { order_price: '9.9', volume_traded: '50' },
        { order_price: null, volume_traded: 1 },
        null as never,
      ],
      asks_per_price: [
        { order_price: 10.2, volume_traded: 10, split: 1 },
        { order_price: 10.1, volume_traded: 20, split: 4 },
        { order_price: 10.3 },
      ],
      total_bids_and_asks: { total_bids: 150, total_asks: '30' },
    });
    expect(book).toEqual({
      bids: [
        { price: 9.9, quantity: 50, orders: null },
        { price: 9.8, quantity: 100, orders: 2 },
      ],
      asks: [
        { price: 10.1, quantity: 20, orders: 4 },
        { price: 10.2, quantity: 10, orders: 1 },
      ],
      totalBidQuantity: 150,
      totalAskQuantity: 30,
    });
  });

  it('maps an empty or missing payload', () => {
    const empty = { bids: [], asks: [], totalBidQuantity: null, totalAskQuantity: null };
    expect(toOrderBook(undefined)).toEqual(empty);
    expect(toOrderBook({ bids_per_price: null, total_bids_and_asks: null })).toEqual(empty);
  });
});

describe('toTapeTrade', () => {
  it('maps a print, stringifying numeric cursors and normalising the side', () => {
    expect(
      toTapeTrade({ cursor: 123, price: '10.5', volume: 7, side: 'sell', time: '2026-01-15T10:00:00Z' }),
    ).toEqual({
      price: 10.5,
      quantity: 7,
      side: 'SELL',
      time: new Date('2026-01-15T10:00:00Z'),
      cursor: '123',
    });
    expect(toTapeTrade({ cursor: 'a', price: 1, volume: 1, side: 'BUY' })).toMatchObject({
      side: 'BUY',
      time: null,
    });
    expect(toTapeTrade({ cursor: 'a', price: 1, volume: 1, side: 'cross' })?.side).toBe('UNKNOWN');
    expect(toTapeTrade({ cursor: 'a', price: 1, volume: 1 })?.side).toBe('UNKNOWN');
  });

  it('rejects rows without cursor, price or volume', () => {
    expect(toTapeTrade(null)).toBeNull();
    expect(toTapeTrade({ price: 1, volume: 1 })).toBeNull();
    expect(toTapeTrade({ cursor: '', price: 1, volume: 1 })).toBeNull();
    expect(toTapeTrade({ cursor: '1', volume: 1 })).toBeNull();
    expect(toTapeTrade({ cursor: '1', price: 1 })).toBeNull();
  });
});

describe('mapRows', () => {
  it('drops rejected rows and tolerates non-arrays', () => {
    expect(mapRows([1, 2, 3], (n) => (n === 2 ? null : n * 10))).toEqual([10, 30]);
    expect(mapRows(null, (n: number) => n)).toEqual([]);
    expect(mapRows({} as never, (n: number) => n)).toEqual([]);
  });
});
