import type { LoginFlow } from './login-flow.js';
import type { ThndrSession } from './thndr-session.js';

/** Persists the authenticated session aggregate. */
export interface SessionRepository {
  load(): Promise<ThndrSession | null>;
  save(session: ThndrSession): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Persists the interactive login state machine so that multi-step logins survive process boundaries
 * (each CLI invocation is a new process; the MCP server may restart between steps).
 */
export interface LoginFlowRepository {
  load(): Promise<LoginFlow>;
  save(flow: LoginFlow): Promise<void>;
}
