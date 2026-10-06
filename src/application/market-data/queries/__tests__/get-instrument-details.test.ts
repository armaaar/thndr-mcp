import { describe, expect, it } from 'vitest';
import {
  anInstrument,
  COMI_ID,
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
});
