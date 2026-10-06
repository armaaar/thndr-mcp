import { describe, expect, it } from 'vitest';
import { MarketQuotesCache } from '../../../src/application/market-data/quote-cache.js';
import type { MarketDataGateway } from '../../../src/application/ports/market-data.js';
import type { Quote } from '../../../src/domain/market-data/instrument.js';
import { aQuote, FakeMarketDataGateway } from '../../support/fake-market-data.js';
import { mutableClock } from '../../support/identity-fakes.js';

describe('MarketQuotesCache', () => {
  it('serves the cached snapshot within the TTL and refetches after it', async () => {
    const gateway = new FakeMarketDataGateway({ quotes: { egypt: [aQuote()] } });
    const clock = mutableClock();
    const cache = new MarketQuotesCache(gateway, clock, 1000);
    const first = await cache.get('egypt');
    clock.advance(999);
    expect(await cache.get('egypt')).toBe(first);
    expect(gateway.calls.getMarketQuotes).toEqual(['egypt']);
    clock.advance(1);
    await cache.get('egypt');
    expect(gateway.calls.getMarketQuotes).toEqual(['egypt', 'egypt']);
  });

  it('caches each market separately with a 10 s default TTL', async () => {
    const gateway = new FakeMarketDataGateway();
    const clock = mutableClock();
    const cache = new MarketQuotesCache(gateway, clock);
    await cache.get('egypt');
    await cache.get('us');
    clock.advance(9_999);
    await cache.get('egypt');
    expect(gateway.calls.getMarketQuotes).toEqual(['egypt', 'us']);
  });

  it('evicts failed fetches so the next call retries', async () => {
    const gateway = new FakeMarketDataGateway();
    gateway.failures.getMarketQuotes = new Error('boom');
    const cache = new MarketQuotesCache(gateway, mutableClock());
    await expect(cache.get('egypt')).rejects.toThrow('boom');
    await Promise.resolve();
    delete gateway.failures.getMarketQuotes;
    gateway.quotes.egypt = [aQuote()];
    expect(await cache.get('egypt')).toHaveLength(1);
    expect(gateway.calls.getMarketQuotes).toHaveLength(2);
  });

  it('does not evict a newer entry when an older fetch fails late', async () => {
    let rejectOld: (e: Error) => void = () => {};
    const fresh = [aQuote()];
    let call = 0;
    const gateway = {
      getMarketQuotes: () => {
        call += 1;
        return call === 1
          ? new Promise<Quote[]>((_, reject) => {
              rejectOld = reject;
            })
          : Promise.resolve(fresh);
      },
    } as unknown as MarketDataGateway;
    const clock = mutableClock();
    const cache = new MarketQuotesCache(gateway, clock, 1000);
    const old = cache.get('egypt');
    clock.advance(1000);
    expect(await cache.get('egypt')).toBe(fresh);
    rejectOld(new Error('late'));
    await expect(old).rejects.toThrow('late');
    expect(await cache.get('egypt')).toBe(fresh);
    expect(call).toBe(2);
  });
});
