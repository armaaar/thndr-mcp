import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/application/errors.js';
import { InstrumentResolver } from '../../../src/application/market-data/instrument-resolver.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';
import { anInstrument, COMI_ID, FakeMarketDataGateway } from '../../support/fake-market-data.js';

function setup() {
  const gateway = new FakeMarketDataGateway({
    instruments: [
      anInstrument({ ticker: 'COMI' }),
      anInstrument({ ticker: 'COMIX' }),
      anInstrument({ ticker: 'AAPL', market: 'us', currency: 'USD' }),
    ],
  });
  return { gateway, resolver: new InstrumentResolver(gateway) };
}

describe('InstrumentResolver', () => {
  it('resolves a ticker case-insensitively via search and caches it', async () => {
    const { gateway, resolver } = setup();
    const first = await resolver.resolve('comi', 'egypt');
    expect(first.ticker.value).toBe('COMI');
    expect(gateway.calls.searchInstruments).toEqual([{ query: 'COMI', market: 'egypt' }]);
    expect(await resolver.resolve('COMI', 'egypt')).toBe(first);
    expect(gateway.calls.searchInstruments).toHaveLength(1);
    // The ticker hit also seeded the id cache.
    expect(await resolver.resolve(COMI_ID, 'egypt')).toBe(first);
    expect(gateway.calls.getInstrument).toHaveLength(0);
  });

  it('caches per market', async () => {
    const { gateway, resolver } = setup();
    await expect(resolver.resolve('AAPL', 'us')).resolves.toMatchObject({ market: 'us' });
    await expect(resolver.resolve('AAPL', 'egypt')).rejects.toThrow(NotFoundError);
    expect(gateway.calls.searchInstruments).toHaveLength(2);
  });

  it('resolves an asset id via getInstrument and caches it', async () => {
    const { gateway, resolver } = setup();
    const byId = await resolver.resolve(COMI_ID.toUpperCase(), 'egypt');
    expect(byId.id.value).toBe(COMI_ID);
    expect(gateway.calls.getInstrument.map((id) => id.value)).toEqual([COMI_ID]);
    await resolver.resolve(COMI_ID, 'egypt');
    await resolver.resolve('COMI', 'egypt');
    expect(gateway.calls.getInstrument).toHaveLength(1);
    expect(gateway.calls.searchInstruments).toHaveLength(0);
  });

  it('suggests close matches when there is no exact ticker', async () => {
    const { resolver } = setup();
    const gateway = new FakeMarketDataGateway({
      instruments: ['COMIA', 'COMIB', 'COMIC', 'COMID', 'COMIE', 'COMIF'].map((t) =>
        anInstrument({ ticker: t }),
      ),
    });
    await expect(new InstrumentResolver(gateway).resolve('COMI', 'egypt')).rejects.toThrow(
      'No egypt instrument with ticker COMI. Did you mean: COMIA, COMIB, COMIC, COMID, COMIE?',
    );
    await expect(resolver.resolve('ZZZZ', 'egypt')).rejects.toThrow(
      'No egypt instrument with ticker ZZZZ. Try search_instruments.',
    );
  });

  it('rejects invalid symbols before calling the gateway', async () => {
    const { gateway, resolver } = setup();
    await expect(resolver.resolve('USD/EGP', 'egypt')).rejects.toThrow(ValidationError);
    expect(gateway.calls.searchInstruments).toHaveLength(0);
  });

  it('resolves many in order and remembers seeded instruments', async () => {
    const { gateway, resolver } = setup();
    const seeded = anInstrument({ ticker: 'HRHO' });
    expect(resolver.remember(seeded)).toBe(seeded);
    const out = await resolver.resolveMany(['HRHO', 'COMI'], 'egypt');
    expect(out.map((i) => i.ticker.value)).toEqual(['HRHO', 'COMI']);
    expect(gateway.calls.searchInstruments).toEqual([{ query: 'COMI', market: 'egypt' }]);
  });
});
