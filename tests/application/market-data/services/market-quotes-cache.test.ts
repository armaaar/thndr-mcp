import { describe, expect, it } from 'vitest';
import { MarketQuotesCache } from '../../../../src/application/market-data/services/market-quotes-cache';
import type { Quote } from '../../../../src/domain/market-data/instrument';
import type { MarketDataRepository } from '../../../../src/domain/market-data/repository';
import { aQuote, FakeMarketDataRepository } from '../../../support/fake-market-data';
import { mutableClock } from '../../../support/identity-fakes';

describe('MarketQuotesCache', () => {
  it('serves the cached snapshot within the TTL and refetches after it', async () => {
    const repository = new FakeMarketDataRepository({ quotes: { egypt: [aQuote()] } });
    const clock = mutableClock();
    const cache = new MarketQuotesCache(repository, clock, 1000);
    const first = await cache.get('egypt');
    clock.advance(999);
    expect(await cache.get('egypt')).toBe(first);
    expect(repository.calls.getMarketQuotes).toEqual(['egypt']);
    clock.advance(1);
    await cache.get('egypt');
    expect(repository.calls.getMarketQuotes).toEqual(['egypt', 'egypt']);
  });

  it('caches each market separately with a 10 s default TTL', async () => {
    const repository = new FakeMarketDataRepository();
    const clock = mutableClock();
    const cache = new MarketQuotesCache(repository, clock);
    await cache.get('egypt');
    await cache.get('us');
    clock.advance(9_999);
    await cache.get('egypt');
    expect(repository.calls.getMarketQuotes).toEqual(['egypt', 'us']);
  });

  it('evicts failed fetches so the next call retries', async () => {
    const repository = new FakeMarketDataRepository();
    repository.failures.getMarketQuotes = new Error('boom');
    const cache = new MarketQuotesCache(repository, mutableClock());
    await expect(cache.get('egypt')).rejects.toThrow('boom');
    await Promise.resolve();
    delete repository.failures.getMarketQuotes;
    repository.quotes.egypt = [aQuote()];
    expect(await cache.get('egypt')).toHaveLength(1);
    expect(repository.calls.getMarketQuotes).toHaveLength(2);
  });

  it('does not evict a newer entry when an older fetch fails late', async () => {
    let rejectOld: (e: Error) => void = () => {};
    const fresh = [aQuote()];
    let call = 0;
    const repository = {
      getMarketQuotes: () => {
        call += 1;
        return call === 1
          ? new Promise<Quote[]>((_, reject) => {
              rejectOld = reject;
            })
          : Promise.resolve(fresh);
      },
    } as unknown as MarketDataRepository;
    const clock = mutableClock();
    const cache = new MarketQuotesCache(repository, clock, 1000);
    const old = cache.get('egypt');
    clock.advance(1000);
    expect(await cache.get('egypt')).toBe(fresh);
    rejectOld(new Error('late'));
    await expect(old).rejects.toThrow('late');
    expect(await cache.get('egypt')).toBe(fresh);
    expect(call).toBe(2);
  });
});
