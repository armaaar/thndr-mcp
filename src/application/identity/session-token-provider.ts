import { AccessToken } from '../../domain/identity/access-token.js';
import type { SessionRepository } from '../../domain/identity/repository.js';
import type { ThndrSession } from '../../domain/identity/thndr-session.js';
import { NotAuthenticatedError, SessionExpiredError } from '../errors.js';
import type { AccessTokenProvider } from '../ports/access-token-provider.js';
import type { Clock } from '../ports/clock.js';
import type { ThndrAuthGateway } from '../ports/identity.js';
import type { Logger } from '../ports/logger.js';

/**
 * Supplies a valid full-access token, refreshing via the persisted refresh credential (ADR 0007).
 * Refreshes are single-flighted so concurrent tool calls trigger at most one refresh.
 */
export class SessionTokenProvider implements AccessTokenProvider {
  private inFlight: Promise<string> | null = null;
  private forceRefresh = false;

  constructor(
    private readonly sessions: SessionRepository,
    private readonly gateway: ThndrAuthGateway,
    private readonly clock: Clock,
    private readonly logger?: Logger,
  ) {}

  async getAccessToken(): Promise<string> {
    const session = await this.sessions.load();
    if (!session) throw new NotAuthenticatedError();
    const now = this.clock.now();
    const cached = this.forceRefresh ? null : session.usableAccessToken(now);
    if (cached) return cached.value;
    if (!this.forceRefresh && session.accessToken?.status(now) === 'ABOUT_TO_EXPIRE') {
      // Still usable: refresh in the background, like ThndrX does.
      this.refresh(session).catch((error: unknown) => {
        this.logger?.warn('thndr: background token refresh failed', { error });
      });
      return session.accessToken.value;
    }
    return this.refresh(session);
  }

  invalidate(): void {
    this.forceRefresh = true;
  }

  private refresh(session: ThndrSession): Promise<string> {
    if (!this.inFlight) {
      this.inFlight = this.doRefresh(session).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async doRefresh(session: ThndrSession): Promise<string> {
    if (session.refresh.isExpired(this.clock.now())) {
      await this.sessions.clear();
      throw new SessionExpiredError();
    }
    try {
      const issued = await this.gateway.refreshAccess(session.refresh);
      const refresh =
        Object.keys(issued.cookies).length > 0 || issued.refreshExpiresAt
          ? session.refresh.merge(issued.cookies, issued.refreshExpiresAt ?? session.refresh.expiresAt)
          : session.refresh;
      const token = AccessToken.of(issued.accessToken, issued.accessTokenExpiresAt);
      await this.sessions.save(session.withAccessToken(token, refresh));
      this.forceRefresh = false;
      this.logger?.info('thndr: access token refreshed', { expiresAt: token.expiresAt.toISOString() });
      return token.value;
    } catch (error) {
      if (error instanceof SessionExpiredError) await this.sessions.clear();
      throw error;
    }
  }
}
