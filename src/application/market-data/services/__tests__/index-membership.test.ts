import { describe, expect, it } from 'vitest';
import {
  aQuote,
  FakeMarketDataRepository,
  fixedClock,
  idFor,
} from '../../../../__tests__/support/fake-market-data';
import type { Clock } from '../../../ports/clock';
import { IndexMembership } from '../index-membership';
import { MarketQuotesCache } from '../market-quotes-cache';

function setup(clock: Clock = fixedClock()) {
  const repository = new FakeMarketDataRepository({
    quotes: {
      egypt: [
        aQuote({ ticker: 'EGX30', board: 'INDX', name: 'EGX 30' }),
        aQuote({ ticker: 'EGX30CAPPED', board: 'INDX', name: null }),
        aQuote({ ticker: 'EGX70-EWI', board: 'INDX' }),
        aQuote({ ticker: 'SHARIAH', board: 'INDX' }),
        aQuote({ ticker: 'COMI' }),
        aQuote({ ticker: 'HRHO' }),
      ],
    },
  });
  repository.indicators = {
    egypt: [
      aQuote({ ticker: 'EGX30CAPPED', board: 'INDX', name: 'EGX30 Capped' }),
      aQuote({ ticker: 'SHARIAH', board: 'INDX', name: 'EGX33 (Sharia)' }),
    ],
  };
  repository.constituents = {
    [idFor('EGX30')]: [idFor('COMI'), idFor('HRHO')],
    [idFor('EGX30CAPPED')]: [idFor('COMI')],
    [idFor('EGX70-EWI')]: [idFor('HRHO')],
    [idFor('SHARIAH')]: [idFor('HRHO')],
  };
  const quotes = new MarketQuotesCache(repository, clock);
  return { repository, indices: new IndexMembership(repository, quotes, clock, 1_000) };
}

describe('IndexMembership', () => {
  it('lists the INDX rows of the market with their members', async () => {
    const { indices } = setup();
    const all = await indices.indices('egypt');
    expect(all.map((i) => [i.ticker.value, i.name, i.members.map((m) => m.value)])).toEqual([
      ['EGX30', 'EGX 30', [idFor('COMI'), idFor('HRHO')]],
      ['EGX30CAPPED', 'EGX30 Capped', [idFor('COMI')]],
      ['EGX70-EWI', 'EGX70-EWI Corp', [idFor('HRHO')]],
      ['SHARIAH', 'SHARIAH Corp', [idFor('HRHO')]],
    ]);
    expect(Object.isFrozen(all[0])).toBe(true);
  });

  it('leaves names it cannot find empty, also when the market indicators fail', async () => {
    const { repository, indices } = setup();
    repository.failures.getMarketIndicators = new Error('down');
    const all = await indices.indices('egypt');
    expect(all.find((i) => i.ticker.value === 'EGX30CAPPED')?.name).toBeNull();
    expect(all.find((i) => i.ticker.value === 'EGX30')?.name).toBe('EGX 30');
  });

  it('finds an index exactly, ignoring case and separators, or by a unique prefix', async () => {
    const { indices } = setup();
    expect((await indices.find('egx30', 'egypt')).ticker.value).toBe('EGX30');
    expect((await indices.find('EGX70 EWI', 'egypt')).ticker.value).toBe('EGX70-EWI');
    expect((await indices.find('EGX70', 'egypt')).ticker.value).toBe('EGX70-EWI');
    expect((await indices.find('sharia', 'egypt')).ticker.value).toBe('SHARIAH');
  });

  it("also finds an index by its name or the name's first word", async () => {
    const { repository, indices } = setup();
    repository.quotes.egypt = (repository.quotes.egypt ?? []).map((q) =>
      q.ticker.value === 'SHARIAH' ? { ...q, name: null } : q,
    );
    expect((await indices.find('EGX33', 'egypt')).ticker.value).toBe('SHARIAH');
    expect((await indices.find('egx33 sharia', 'egypt')).ticker.value).toBe('SHARIAH');
    expect((await indices.find('EGX30 Capped', 'egypt')).ticker.value).toBe('EGX30CAPPED');
  });

  it('reports a name shared by two indices as ambiguous', async () => {
    const { repository, indices } = setup();
    repository.indicators.egypt = [
      aQuote({ ticker: 'EGX30CAPPED', board: 'INDX', name: 'EGX99 Capped' }),
      aQuote({ ticker: 'SHARIAH', board: 'INDX', name: 'EGX99 Sharia' }),
    ];
    repository.quotes.egypt = (repository.quotes.egypt ?? []).map((q) =>
      q.ticker.value === 'SHARIAH' ? { ...q, name: null } : q,
    );
    await expect(indices.find('EGX99', 'egypt')).rejects.toThrow('Indices: EGX30CAPPED, SHARIAH.');
  });

  it('rejects unknown or ambiguous names and lists the candidates', async () => {
    const { indices } = setup();
    await expect(indices.find('EGX', 'egypt')).rejects.toThrow(
      'No single egypt index matches "EGX". Indices: EGX30, EGX30CAPPED, EGX70-EWI.',
    );
    await expect(indices.find('NOPE', 'egypt')).rejects.toThrow(
      'Indices: EGX30, EGX30CAPPED, EGX70-EWI, SHARIAH.',
    );
    await expect(indices.find('', 'egypt')).rejects.toThrow('No single egypt index matches ""');
    await expect(indices.find('X', 'us')).rejects.toThrow('No single us index matches "X".');
  });

  it('maps each instrument to the indices it belongs to', async () => {
    const { indices } = setup();
    const membership = await indices.membership('egypt');
    expect(membership.get(idFor('COMI'))).toEqual(['EGX30', 'EGX30CAPPED']);
    expect(membership.get(idFor('HRHO'))).toEqual(['EGX30', 'EGX70-EWI', 'SHARIAH']);
    expect(membership.has(idFor('EGX30'))).toBe(false);
  });

  it('caches the members per market until the TTL passes, and retries after a failure', async () => {
    let now = new Date('2026-01-01T12:00:00Z').getTime();
    const clock = { now: () => new Date(now) };
    const { repository, indices } = setup(clock);
    await indices.indices('egypt');
    await indices.indices('egypt');
    expect(repository.calls.getIndexConstituents).toHaveLength(4);
    now += 1_001;
    repository.failures.getIndexConstituents = new Error('boom');
    await expect(indices.indices('egypt')).rejects.toThrow('boom');
    repository.failures = {};
    await indices.indices('egypt');
    // Indices load one at a time, so the failed load stopped after its first call.
    expect(repository.calls.getIndexConstituents).toHaveLength(9);
  });

  it('does not cache an empty index list, so a snapshot without index rows is retried', async () => {
    const { repository } = setup();
    const clock = fixedClock();
    const indices = new IndexMembership(repository, new MarketQuotesCache(repository, clock, 0), clock);
    const quotes = repository.quotes.egypt ?? [];
    repository.quotes.egypt = quotes.filter((q) => q.board !== 'INDX');
    expect(await indices.indices('egypt')).toEqual([]);
    repository.quotes.egypt = quotes;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await indices.indices('egypt')).toHaveLength(4);
    expect(await indices.indices('egypt')).toHaveLength(4);
    expect(repository.calls.getIndexConstituents).toHaveLength(4);
  });

  it('keeps an answer with a memberless index for 5 minutes only', async () => {
    let now = new Date('2026-01-01T12:00:00Z').getTime();
    const clock = { now: () => new Date(now) };
    const { repository } = setup(clock);
    const indices = new IndexMembership(repository, new MarketQuotesCache(repository, clock, 0), clock);
    repository.constituents[idFor('EGX70-EWI')] = [];
    const first = await indices.indices('egypt');
    expect(first.find((i) => i.ticker.value === 'EGX70-EWI')?.members).toEqual([]);
    repository.constituents[idFor('EGX70-EWI')] = [idFor('HRHO')];
    await new Promise((resolve) => setTimeout(resolve, 0));
    now += 5 * 60_000 - 1;
    expect((await indices.indices('egypt')).find((i) => i.ticker.value === 'EGX70-EWI')?.members).toEqual([]);
    now += 1;
    const second = await indices.indices('egypt');
    expect(second.find((i) => i.ticker.value === 'EGX70-EWI')?.members.map((m) => m.value)).toEqual([
      idFor('HRHO'),
    ]);
  });

  it('keeps members for 6 hours by default', async () => {
    let now = new Date('2026-01-01T12:00:00Z').getTime();
    const clock = { now: () => new Date(now) };
    const { repository } = setup(clock);
    const indices = new IndexMembership(repository, new MarketQuotesCache(repository, clock), clock);
    await indices.indices('egypt');
    now += 6 * 3_600_000 - 1;
    await indices.indices('egypt');
    expect(repository.calls.getIndexConstituents).toHaveLength(4);
    now += 1;
    await indices.indices('egypt');
    expect(repository.calls.getIndexConstituents).toHaveLength(8);
  });

  it('never lets a failed load evict a newer entry', async () => {
    let now = new Date('2026-01-01T12:00:00Z').getTime();
    const clock = { now: () => new Date(now) };
    const { repository, indices } = setup(clock);
    const original = repository.getIndexConstituents.bind(repository);
    let fail: () => void = () => {};
    repository.getIndexConstituents = () =>
      new Promise((_, reject) => {
        fail = () => reject(new Error('late'));
      });
    const stale = indices.indices('egypt');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now += 1_001;
    repository.getIndexConstituents = original;
    await indices.indices('egypt');
    const calls = repository.calls.getIndexConstituents.length;
    fail();
    await expect(stale).rejects.toThrow('late');
    expect(await indices.indices('egypt')).toHaveLength(4);
    expect(repository.calls.getIndexConstituents).toHaveLength(calls);
  });
});
