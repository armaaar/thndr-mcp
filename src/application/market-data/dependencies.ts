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
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
  indices: IndexMembership;
  clock: Clock;
}
