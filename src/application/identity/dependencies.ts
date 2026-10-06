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
  /**
   * Name of this device in the approval deep link (its `user_agent` parameter, which ThndrX fills with the browser's
   * user agent). Kept short: the deep link is shown as a QR code, and every character makes the QR bigger.
   */
  deviceName: string;
  sleep?: (ms: number) => Promise<void>;
  /** How often `login_complete` polls the approval status (default 1000 ms, minimum 10 ms). */
  pollIntervalMs?: number;
}
