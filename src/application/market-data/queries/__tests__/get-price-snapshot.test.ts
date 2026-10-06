import { describe, expect, it } from 'vitest';
import {
  aLatestPrice,
  anInstrument,
  aQuote,
  aUsInstrument,
  FakeMarketDataRepository,
  idFor,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { ValidationError } from '../../../../domain/shared-kernel/errors';
import { UpstreamError } from '../../../errors';
import { GetPriceSnapshot } from '../get-price-snapshot';

describe('GetPriceSnapshot', () => {
  it('declares its contract', async () => {
    const uc = new GetPriceSnapshot(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_price_snapshot', kind: 'query', context: 'market-data' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbols: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbols: Array.from({ length: 51 }, () => 'COMI') })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ symbols: ['COMI'], symbol: 'COMI' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(uc.run({ symbols: ['COMI'], market: 'mars' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('returns quotes in request order and reports instruments without a quote', async () => {
    const repository = withInstruments('COMI', 'HRHO', 'ETEL');
    repository.quotes.egypt = [aQuote({ ticker: 'ETEL' }), aQuote({ ticker: 'COMI' })];
    const deps = setupMarketData(repository);
    const out = await new GetPriceSnapshot(deps).run({ symbols: ['COMI', 'HRHO', 'ETEL'] });
    expect(out.quotes.map((q) => q.ticker.value)).toEqual(['COMI', 'ETEL']);
    expect(out.missing).toEqual(['HRHO']);
    expect(repository.calls.getMarketQuotes).toEqual(['egypt']);
  });

  it('guards the number of symbols when executed directly', async () => {
    const uc = new GetPriceSnapshot(setupMarketData());
    await expect(uc.execute({ symbols: [] })).rejects.toThrow(ValidationError);
    await expect(uc.execute({ symbols: [] })).rejects.toThrow('Provide at least one symbol');
    await expect(uc.execute({ symbols: Array.from({ length: 51 }, () => 'COMI') })).rejects.toThrow(
      'At most 50 symbols per request',
    );
  });

  it('quotes US instruments from the bulk latest price, never from marketwatch', async () => {
    const repository = new FakeMarketDataRepository({
      instruments: [aUsInstrument(), aUsInstrument({ ticker: 'MSFT' })],
    });
    repository.latestPrices = [aLatestPrice({ ticker: 'NVDA', bid: 240, ask: 240.2, kind: 'trade' })];
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({
      symbols: ['NVDA', 'MSFT'],
      market: 'us',
    });
    expect(repository.calls.getMarketQuotes).toEqual([]);
    expect(repository.calls.getLatestPrices).toEqual([[idFor('NVDA'), idFor('MSFT')]]);
    expect(out.missing).toEqual(['MSFT']);
    expect(out.quotes).toHaveLength(1);
    expect(out.quotes[0]).toMatchObject({
      name: 'NVIDIA Corporation Common Stock',
      sector: 'Semiconductors & Semiconductor Equipment',
      currency: 'USD',
      last: 240.1,
      open: 242.1,
      previousClose: 238.9,
      change: 1.2,
      changePercent: 0.5023,
      bid: 240,
      ask: 240.2,
      lastTradePrice: 240.1,
      high: null,
      volume: null,
      marketCap: null,
    });
    expect(out.notes).toEqual([expect.stringContaining('bulk latest price')]);
  });

  it('quotes UAE instruments from the bulk latest price', async () => {
    const fab = anInstrument({ ticker: 'FAB', market: 'uae', currency: 'AED' });
    const repository = new FakeMarketDataRepository({ instruments: [fab] });
    repository.latestPrices = [
      aLatestPrice({ ticker: 'FAB', last: 19.12, previousClose: 19.4, open: 19.42 }),
    ];
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({
      symbols: ['FAB'],
      market: 'uae',
    });
    expect(repository.calls.getMarketQuotes).toEqual([]);
    expect(out.quotes[0]).toMatchObject({
      currency: 'AED',
      last: 19.12,
      change: -0.28,
      changePercent: -1.4433,
    });
  });

  it('follows each instrument’s own market: simulator listings use Egypt’s snapshot, US ones the bulk price', async () => {
    const comi = anInstrument({ ticker: 'COMI' });
    const nvda = aUsInstrument();
    const repository = new FakeMarketDataRepository({ instruments: [comi, nvda] });
    // The simulator's search answers with Egyptian and US listings, each with its own market.
    repository.searchInstruments = async (query) => [comi, nvda].filter((i) => i.ticker.value === query);
    repository.quotes.egypt = [aQuote({ ticker: 'COMI' })];
    repository.latestPrices = [aLatestPrice()];
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({
      symbols: ['COMI', 'NVDA'],
      market: 'simulator',
    });
    expect(repository.calls.getMarketQuotes).toEqual(['egypt']);
    expect(repository.calls.getLatestPrices).toEqual([[idFor('NVDA')]]);
    expect(out.quotes.map((q) => [q.ticker.value, q.volume])).toEqual([
      ['COMI', 1_000_000],
      ['NVDA', null],
    ]);
  });

  it('mixes asset ids of different markets and falls back to the bulk price for Egyptian rows missing', async () => {
    const repository = new FakeMarketDataRepository({
      instruments: [anInstrument({ ticker: 'COMI' }), anInstrument({ ticker: 'BMM' }), aUsInstrument()],
    });
    repository.quotes.egypt = [aQuote({ ticker: 'COMI' })];
    repository.latestPrices = [aLatestPrice(), aLatestPrice({ ticker: 'BMM', last: 12, kind: 'nav' })];
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({
      symbols: [idFor('NVDA'), idFor('COMI'), idFor('BMM')],
    });
    expect(out.quotes.map((q) => q.ticker.value)).toEqual(['NVDA', 'COMI', 'BMM']);
    expect(repository.calls.getLatestPrices).toEqual([[idFor('NVDA'), idFor('BMM')]]);
    expect(out.quotes[2]).toMatchObject({ last: 12, lastTradePrice: null });
  });

  it('adds no note when every quote is a marketwatch row', async () => {
    const repository = withInstruments('COMI');
    repository.quotes.egypt = [aQuote({ ticker: 'COMI' })];
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({ symbols: ['COMI'] });
    expect(out.notes).toBeUndefined();
    expect(repository.calls.getLatestPrices).toEqual([]);
  });

  it('lists Egyptian rows missing from the snapshot as missing when the bulk-price fallback fails', async () => {
    const repository = withInstruments('COMI', 'BMM');
    repository.quotes.egypt = [aQuote({ ticker: 'COMI' })];
    repository.failures.getLatestPrices = new UpstreamError('Thndr API error 403', 403, 'FEATURE_DISABLED');
    const out = await new GetPriceSnapshot(setupMarketData(repository)).run({ symbols: ['COMI', 'BMM'] });
    expect(out.quotes.map((q) => q.ticker.value)).toEqual(['COMI']);
    expect(out.missing).toEqual(['BMM']);
  });

  it('fails when the bulk price fails for instruments it is the only source of', async () => {
    const repository = new FakeMarketDataRepository({ instruments: [aUsInstrument()] });
    repository.failures.getLatestPrices = new UpstreamError('Thndr API error 500', 500);
    await expect(
      new GetPriceSnapshot(setupMarketData(repository)).run({ symbols: ['NVDA'], market: 'us' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    const egypt = withInstruments('BMM');
    egypt.failures.getLatestPrices = new TypeError('bug');
    await expect(new GetPriceSnapshot(setupMarketData(egypt)).run({ symbols: ['BMM'] })).rejects.toThrow(
      'bug',
    );
  });
});
