import type { PortfolioRepository } from '../../domain/portfolio/repository';
import type { InstrumentResolver } from '../market-data/services/instrument-resolver';
import type { Clock } from '../ports/clock';

/**
 * Collaborators shared by the Portfolio use cases. All of them are read-only (ADR 0006): nothing in this context
 * places, modifies or cancels orders or moves funds.
 */
export interface PortfolioDependencies {
  repository: PortfolioRepository;
  resolver: InstrumentResolver;
  clock: Clock;
}
