import type { ThndrSession } from './thndr-session.js';

/** Persists the authenticated session aggregate. */
export interface SessionRepository {
  load(): Promise<ThndrSession | null>;
  save(session: ThndrSession): Promise<void>;
  clear(): Promise<void>;
}
