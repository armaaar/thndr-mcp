import type { MarketDataRepository } from '../../domain/market-data/repository';
import type { Clock } from '../ports/clock';
import type { IndexMembership } from './services/index-membership';
import type { InstrumentResolver } from './services/instrument-resolver';
import type { MarketQuotesCache } from './services/market-quotes-cache';

/** Collaborators shared by the Market Data use cases. */
export interface MarketDataDependencies {
  repository: MarketDataRepository;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
  indices: IndexMembership;
  clock: Clock;
}
