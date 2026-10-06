import type { EngagementRepository } from '../../domain/engagement/repository';
import type { InstrumentResolver } from '../market-data/services/instrument-resolver';
import type { MarketQuotesCache } from '../market-data/services/market-quotes-cache';

/** Collaborators shared by the Engagement use cases. */
export interface EngagementDependencies {
  repository: EngagementRepository;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
}
