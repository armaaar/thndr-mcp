import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../../src/application/errors';
import { InstrumentResolver } from '../../../../src/application/market-data/services/instrument-resolver';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { anInstrument, COMI_ID, FakeMarketDataRepository } from '../../../support/fake-market-data';

function setup() {
  const repository = new FakeMarketDataRepository({
    instruments: [
      anInstrument({ ticker: 'COMI' }),
      anInstrument({ ticker: 'COMIX' }),
      anInstrument({ ticker: 'AAPL', market: 'us', currency: 'USD' }),
    ],
  });
  return { repository, resolver: new InstrumentResolver(repository) };
}

describe('InstrumentResolver', () => {
  it('resolves a ticker case-insensitively via search and caches it', async () => {
    const { repository, resolver } = setup();
    const first = await resolver.resolve('comi', 'egypt');
    expect(first.ticker.value).toBe('COMI');
    expect(repository.calls.searchInstruments).toEqual([{ query: 'COMI', market: 'egypt' }]);
    expect(await resolver.resolve('COMI', 'egypt')).toBe(first);
    expect(repository.calls.searchInstruments).toHaveLength(1);
    // The ticker hit also seeded the id cache.
    expect(await resolver.resolve(COMI_ID, 'egypt')).toBe(first);
    expect(repository.calls.getInstrument).toHaveLength(0);
  });

  it('caches per market', async () => {
    const { repository, resolver } = setup();
    await expect(resolver.resolve('AAPL', 'us')).resolves.toMatchObject({ market: 'us' });
    await expect(resolver.resolve('AAPL', 'egypt')).rejects.toThrow(NotFoundError);
    expect(repository.calls.searchInstruments).toHaveLength(2);
  });

  it('resolves an asset id via getInstrument and caches it', async () => {
    const { repository, resolver } = setup();
    const byId = await resolver.resolve(COMI_ID.toUpperCase(), 'egypt');
    expect(byId.id.value).toBe(COMI_ID);
    expect(repository.calls.getInstrument.map((id) => id.value)).toEqual([COMI_ID]);
    await resolver.resolve(COMI_ID, 'egypt');
    await resolver.resolve('COMI', 'egypt');
    expect(repository.calls.getInstrument).toHaveLength(1);
    expect(repository.calls.searchInstruments).toHaveLength(0);
  });

  it('suggests close matches when there is no exact ticker', async () => {
    const { resolver } = setup();
    const repository = new FakeMarketDataRepository({
      instruments: ['COMIA', 'COMIB', 'COMIC', 'COMID', 'COMIE', 'COMIF'].map((t) =>
        anInstrument({ ticker: t }),
      ),
    });
    await expect(new InstrumentResolver(repository).resolve('COMI', 'egypt')).rejects.toThrow(
      'No egypt instrument with ticker COMI. Did you mean: COMIA, COMIB, COMIC, COMID, COMIE?',
    );
    await expect(resolver.resolve('ZZZZ', 'egypt')).rejects.toThrow(
      'No egypt instrument with ticker ZZZZ. Try search_instruments.',
    );
  });

  it('rejects invalid symbols before calling the repository', async () => {
    const { repository, resolver } = setup();
    await expect(resolver.resolve('USD/EGP', 'egypt')).rejects.toThrow(ValidationError);
    expect(repository.calls.searchInstruments).toHaveLength(0);
  });

  it('resolves many in order and remembers seeded instruments', async () => {
    const { repository, resolver } = setup();
    const seeded = anInstrument({ ticker: 'HRHO' });
    expect(resolver.remember(seeded)).toBe(seeded);
    const out = await resolver.resolveMany(['HRHO', 'COMI'], 'egypt');
    expect(out.map((i) => i.ticker.value)).toEqual(['HRHO', 'COMI']);
    expect(repository.calls.searchInstruments).toEqual([{ query: 'COMI', market: 'egypt' }]);
  });
});
