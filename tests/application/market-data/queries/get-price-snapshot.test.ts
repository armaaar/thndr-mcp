import { describe, expect, it } from 'vitest';
import { GetPriceSnapshot } from '../../../../src/application/market-data/queries/get-price-snapshot';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { aQuote, setupMarketData, withInstruments } from '../../../support/fake-market-data';

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
});
