import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  aQuote,
  COMI_ID,
  idFor,
  setupMarketData,
  withInstruments,
} from '../../../../__tests__/support/fake-market-data';
import { GetInstrumentDetails } from '../get-instrument-details';

describe('GetInstrumentDetails', () => {
  it('declares its contract', async () => {
    const uc = new GetInstrumentDetails(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_instrument_details', kind: 'query', context: 'market-data' });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', ticker: 'COMI' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ symbol: 'COMI', market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('resolves the symbol in the default market, then loads the full details', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    const out = await new GetInstrumentDetails(deps).run({ symbol: 'comi' });
    expect(out.ticker.value).toBe('COMI');
    expect(deps.repository.calls.searchInstruments).toEqual([{ query: 'COMI', market: 'egypt' }]);
    expect(deps.repository.calls.getInstrument.map((id) => id.value)).toEqual([COMI_ID]);
  });

  it('honours the market', async () => {
    const repository = withInstruments();
    repository.instruments = [anInstrument({ ticker: 'AAPL', market: 'us', currency: 'USD' })];
    const out = await new GetInstrumentDetails(setupMarketData(repository)).run({
      symbol: 'AAPL',
      market: 'us',
    });
    expect(out).toMatchObject({ market: 'us', currency: 'USD' });
  });

  it('adds the indices the instrument belongs to, and their tags', async () => {
    const repository = withInstruments();
    repository.instruments = [anInstrument({ ticker: 'COMI', tags: ['Banks', 'EGX30 Index'] })];
    repository.quotes = {
      egypt: [
        aQuote({ ticker: 'EGX30', board: 'INDX' }),
        aQuote({ ticker: 'SHARIAH', board: 'INDX' }),
        aQuote(),
      ],
    };
    repository.constituents = { [idFor('EGX30')]: [COMI_ID], [idFor('SHARIAH')]: [] };
    const out = await new GetInstrumentDetails(setupMarketData(repository)).run({ symbol: 'COMI' });
    expect(out).toMatchObject({
      ticker: expect.objectContaining({ value: 'COMI' }),
      tags: ['Banks', 'EGX30 Index'],
    });
    expect(out.indices).toEqual(['EGX30']);
  });

  it('returns no indices for a non-member, and null when membership cannot be loaded', async () => {
    const deps = setupMarketData(withInstruments('COMI'));
    expect((await new GetInstrumentDetails(deps).run({ symbol: 'COMI' })).indices).toEqual([]);
    deps.repository.failures.getMarketQuotes = new Error('marketwatch down');
    const out = await new GetInstrumentDetails(setupMarketData(deps.repository)).run({ symbol: 'COMI' });
    expect(out.indices).toBeNull();
    expect(out.ticker.value).toBe('COMI');
  });

  it.each(['us', 'uae'] as const)(
    'never asks for index membership in %s: indices is null',
    async (market) => {
      const repository = withInstruments();
      repository.instruments = [anInstrument({ ticker: 'FAB', market })];
      const deps = setupMarketData(repository);
      const out = await new GetInstrumentDetails(deps).run({ symbol: 'FAB', market });
      expect(out.indices).toBeNull();
      expect(repository.calls.getMarketQuotes).toEqual([]);
      expect(repository.calls.getIndexConstituents).toEqual([]);
    },
  );

  it('reads Egypt’s index membership for an Egyptian listing found through the simulator', async () => {
    const repository = withInstruments();
    repository.instruments = [anInstrument({ ticker: 'COMI', market: 'egypt' })];
    repository.searchInstruments = async () => repository.instruments;
    const deps = setupMarketData(repository);
    const out = await new GetInstrumentDetails(deps).run({ symbol: 'COMI', market: 'simulator' });
    expect(repository.calls.getMarketQuotes).toEqual(['egypt']);
    expect(out.indices).toEqual([]);
  });
});
