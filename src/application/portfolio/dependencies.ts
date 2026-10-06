import type { PortfolioRepository } from '../../domain/portfolio/repository';
import type { IndexMembership } from '../market-data/services/index-membership';
import type { InstrumentResolver } from '../market-data/services/instrument-resolver';
import type { MarketQuotesCache } from '../market-data/services/market-quotes-cache';
import type { Clock } from '../ports/clock';

/**
 * Collaborators shared by the Portfolio use cases. All of them are read-only (ADR 0006): nothing in this context
 * places, modifies or cancels orders or moves funds. `quotes` (sectors) and `indices` (index membership) are Market
 * Data's published services.
 */
export interface PortfolioDependencies {
  repository: PortfolioRepository;
  resolver: InstrumentResolver;
  quotes: MarketQuotesCache;
  indices: IndexMembership;
  clock: Clock;
}
