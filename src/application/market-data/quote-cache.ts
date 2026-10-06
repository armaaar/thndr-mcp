import type { Quote } from '../../domain/market-data/instrument.js';
import type { Market } from '../../domain/market-data/market.js';
import type { Clock } from '../ports/clock.js';
import type { MarketDataGateway } from '../ports/market-data.js';

/**
 * Short-lived cache of the whole-market snapshot. One marketwatch call serves every quote, screen and mover
 * request within `ttlMs` (ThndrX itself polls this endpoint).
 */
export class MarketQuotesCache {
  private readonly entries = new Map<Market, { at: number; quotes: Promise<Quote[]> }>();

  constructor(
    private readonly gateway: MarketDataGateway,
    private readonly clock: Clock,
    private readonly ttlMs = 10_000,
  ) {}

  get(market: Market): Promise<Quote[]> {
    const now = this.clock.now().getTime();
    const entry = this.entries.get(market);
    if (entry && now - entry.at < this.ttlMs) return entry.quotes;
    const quotes = this.gateway.getMarketQuotes(market);
    const fresh = { at: now, quotes };
    this.entries.set(market, fresh);
    // Evict failures so the next call retries — but never evict a newer entry that replaced this one.
    quotes.catch(() => {
      if (this.entries.get(market) === fresh) this.entries.delete(market);
    });
    return quotes;
  }
}
