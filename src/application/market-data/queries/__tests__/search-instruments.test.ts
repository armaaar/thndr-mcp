import { describe, expect, it } from 'vitest';
import { setupMarketData, withInstruments } from '../../../../__tests__/support/fake-market-data';
import { ValidationError } from '../../../../domain/shared-kernel/errors';
import { SearchInstruments } from '../search-instruments';

const many = () => withInstruments(...Array.from({ length: 60 }, (_, i) => `CO${i}`));

describe('SearchInstruments', () => {
  it('declares its contract', async () => {
    const uc = new SearchInstruments(setupMarketData());
    expect(uc).toMatchObject({
      name: 'search_instruments',
      kind: 'query',
      context: 'market-data',
      title: 'Search instruments',
      local: false,
    });
    await expect(uc.run({})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ query: 'CO', max_results: 5 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ query: 'CO', market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ query: 'CO', limit: 51 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('applies defaults via run(): egypt market and 20 results', async () => {
    const deps = setupMarketData(many());
    const out = await new SearchInstruments(deps).run({ query: 'CO' });
    expect(deps.repository.calls.searchInstruments).toEqual([{ query: 'CO', market: 'egypt' }]);
    expect(out.results).toHaveLength(20);
  });

  it('trims the query, seeds the resolver and limits results', async () => {
    const deps = setupMarketData(many());
    const out = await new SearchInstruments(deps).execute({ query: ' co ', market: 'egypt', limit: 5 });
    expect(deps.repository.calls.searchInstruments).toEqual([{ query: 'co', market: 'egypt' }]);
    expect(out.results.map((i) => i.ticker.value)).toEqual(['CO0', 'CO1', 'CO2', 'CO3', 'CO4']);
    await deps.resolver.resolve('CO59', 'egypt');
    expect(deps.repository.calls.searchInstruments).toHaveLength(1);
  });

  it('defaults and clamps the limit when executed directly', async () => {
    const uc = new SearchInstruments(setupMarketData(many()));
    expect((await uc.execute({ query: 'CO' })).results).toHaveLength(20);
    expect((await uc.execute({ query: 'CO', limit: 0 })).results).toHaveLength(1);
    expect((await uc.execute({ query: 'CO', limit: 500 })).results).toHaveLength(50);
  });

  it('rejects a blank query', async () => {
    await expect(new SearchInstruments(setupMarketData()).run({ query: '  ' })).rejects.toThrow(
      ValidationError,
    );
  });
});
