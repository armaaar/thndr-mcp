import type { DiscoveryRepository } from '../../domain/market-data/discovery-repository';
import type { MarketDataRepository } from '../../domain/market-data/repository';
import type { ResearchRepository } from '../../domain/market-data/research-repository';
import type { Clock } from '../ports/clock';
import type { IndexMembership } from './services/index-membership';
import type { InstrumentResolver } from './services/instrument-resolver';
import type { MarketQuotesCache } from './services/market-quotes-cache';

/** Collaborators shared by the Market Data use cases. */
export interface MarketDataDependencies {
  repository: MarketDataRepository;
  /** Fundamentals, news and macro data (ADR 0018). */
  research: ResearchRepository;
  /** The user's markets, movers, trending, tags and dividends from Thndr's mobile-app endpoints (ADR 0021). */
  discovery: DiscoveryRepository;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
  indices: IndexMembership;
  clock: Clock;
}
