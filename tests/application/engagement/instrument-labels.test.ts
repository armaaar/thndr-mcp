import { describe, expect, it } from 'vitest';
import {
  assetIdOrNull,
  emptyLabel,
  InstrumentLabeler,
} from '../../../src/application/engagement/instrument-labels.js';
import { InstrumentResolver } from '../../../src/application/market-data/instrument-resolver.js';
import { MarketQuotesCache } from '../../../src/application/market-data/quote-cache.js';
import { AssetId } from '../../../src/domain/market-data/asset-id.js';
import {
  anInstrument,
  aQuote,
  FakeMarketDataRepository,
  fixedClock,
  idFor,
} from '../../support/fake-market-data.js';

function setup(market = new FakeMarketDataRepository()) {
  return {
    market,
    labeler: new InstrumentLabeler(
      new InstrumentResolver(market),
      new MarketQuotesCache(market, fixedClock()),
    ),
  };
}

const id = (ticker: string) => AssetId.of(idFor(ticker));

describe('InstrumentLabeler.label', () => {
  it('returns an empty set without calling upstream', async () => {
    const { market, labeler } = setup();
    const labels = await labeler.label([], 'egypt');
    expect(labels.get(id('COMI'))).toEqual(emptyLabel(idFor('COMI')));
    expect(market.calls.getMarketQuotes).toEqual([]);
  });

  it('uses quotes first, then the resolver, and tolerates unknown ids', async () => {
    const market = new FakeMarketDataRepository({
      quotes: { egypt: [aQuote({ ticker: 'COMI', last: 80, changePercent: 1.5 })] },
      instruments: [anInstrument({ ticker: 'EGX30', name: 'EGX 30' })],
    });
    const { labeler } = setup(market);
    const labels = await labeler.label(
      [id('COMI'), id('EGX30'), id('GONE'), id('GONE'), id('COMI')],
      'egypt',
    );
    expect(labels.get(id('COMI'))).toEqual({
      instrumentId: idFor('COMI'),
      ticker: 'COMI',
      name: 'COMI Corp',
      last: 80,
      changePercent: 1.5,
    });
    expect(labels.get(id('EGX30'))).toEqual({
      ...emptyLabel(idFor('EGX30')),
      ticker: 'EGX30',
      name: 'EGX 30',
    });
    expect(labels.get(id('GONE'))).toEqual(emptyLabel(idFor('GONE')));
    expect(market.calls.getInstrument.map((i) => i.value)).toEqual([idFor('EGX30'), idFor('GONE')]);
    expect(market.calls.getMarketQuotes).toEqual(['egypt']);
  });

  it('survives a failing snapshot', async () => {
    const market = new FakeMarketDataRepository({ instruments: [anInstrument({ ticker: 'COMI' })] });
    market.failures.getMarketQuotes = new Error('down');
    const { labeler } = setup(market);
    expect((await labeler.label([id('COMI')], 'egypt')).get(id('COMI')).ticker).toBe('COMI');
  });
});

describe('InstrumentLabeler.currentPrice', () => {
  it('reads the last price from the snapshot', async () => {
    const market = new FakeMarketDataRepository({
      quotes: { egypt: [aQuote({ ticker: 'COMI', last: 81 })] },
    });
    const { labeler } = setup(market);
    expect(await labeler.currentPrice(id('COMI'), 'egypt')).toBe(81);
    expect(await labeler.currentPrice(id('HRHO'), 'egypt')).toBeNull();
  });

  it('returns null when the snapshot fails', async () => {
    const market = new FakeMarketDataRepository();
    market.failures.getMarketQuotes = new Error('down');
    expect(await setup(market).labeler.currentPrice(id('COMI'), 'egypt')).toBeNull();
  });
});

describe('assetIdOrNull', () => {
  it('parses UUIDs only', () => {
    expect(assetIdOrNull(idFor('COMI').toUpperCase())?.value).toBe(idFor('COMI'));
    expect(assetIdOrNull('COMI')).toBeNull();
  });
});
