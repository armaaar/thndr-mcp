import type { LoginFlowRepository, SessionRepository } from '../../domain/identity/repository';
import type { Clock } from '../ports/clock';
import type { IdentityProvider, ThndrAuthGateway } from '../ports/identity';

/** Collaborators shared by the Identity & Access use cases. */
export interface LoginDependencies {
  gateway: ThndrAuthGateway;
  identity: IdentityProvider;
  sessions: SessionRepository;
  flow: LoginFlowRepository;
  clock: Clock;
  /** User agent shown to the user in the Thndr app approval screen. */
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  /** How often `login_complete` polls the approval status (default 1000 ms, minimum 10 ms). */
  pollIntervalMs?: number;
}
