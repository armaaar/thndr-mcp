import { describe, expect, it } from 'vitest';
import {
  NotAuthenticatedError,
  SessionExpiredError,
  UpstreamError,
} from '../../../../src/application/errors';
import { SessionTokenProvider } from '../../../../src/application/identity/services/session-token-provider';
import { AccessToken } from '../../../../src/domain/identity/access-token';
import { RefreshCredential } from '../../../../src/domain/identity/refresh-credential';
import { ThndrSession } from '../../../../src/domain/identity/thndr-session';
import {
  fakeGateway,
  fakeLogger,
  InMemorySessionRepository,
  issued,
  mutableClock,
  T0,
} from '../../../support/identity-fakes';

const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function sessionWith(tokenExpiresAt: Date | null, refreshExpiresAt: Date | null = minutes(360)) {
  const refresh = RefreshCredential.of({ sid: 'r1', other: 'o1' }, refreshExpiresAt);
  const token = tokenExpiresAt ? AccessToken.of('cached-token', tokenExpiresAt) : null;
  return ThndrSession.establish(refresh, token, minutes(-60));
}

function setup(session: ThndrSession | null, gatewayOverrides = {}) {
  const sessions = new InMemorySessionRepository(session);
  const gateway = fakeGateway(gatewayOverrides);
  const clock = mutableClock();
  const logger = fakeLogger();
  const provider = new SessionTokenProvider(sessions, gateway, clock, logger);
  return { sessions, gateway, clock, logger, provider };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SessionTokenProvider', () => {
  it('throws NotAuthenticatedError without a session', async () => {
    const { provider, gateway } = setup(null);
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(gateway.refreshAccess).not.toHaveBeenCalled();
  });

  it('returns a VALID cached token without refreshing', async () => {
    const { provider, gateway } = setup(sessionWith(minutes(10)));
    await expect(provider.getAccessToken()).resolves.toBe('cached-token');
    expect(gateway.refreshAccess).not.toHaveBeenCalled();
  });

  it('returns an ABOUT_TO_EXPIRE token and refreshes in the background', async () => {
    const { provider, gateway, sessions, logger } = setup(sessionWith(minutes(2)));
    await expect(provider.getAccessToken()).resolves.toBe('cached-token');
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
    await flush();
    expect(sessions.saves).toHaveLength(1);
    expect(sessions.session?.accessToken?.value).toBe('new-token');
    expect(logger.info).toHaveBeenCalledWith('thndr: access token refreshed', {
      expiresAt: minutes(15).toISOString(),
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a failed background refresh and keeps the session', async () => {
    const failure = new UpstreamError('down', 503);
    const { provider, sessions, logger } = setup(sessionWith(minutes(2)), {
      refreshAccess: async () => {
        throw failure;
      },
    });
    await expect(provider.getAccessToken()).resolves.toBe('cached-token');
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('thndr: background token refresh failed', { error: failure });
    expect(sessions.clears).toBe(0);
    expect(sessions.session).not.toBeNull();
  });

  it('tolerates a failing background refresh without a logger', async () => {
    const sessions = new InMemorySessionRepository(sessionWith(minutes(2)));
    const gateway = fakeGateway({
      refreshAccess: async () => {
        throw new UpstreamError('down');
      },
    });
    const provider = new SessionTokenProvider(sessions, gateway, mutableClock());
    await expect(provider.getAccessToken()).resolves.toBe('cached-token');
    await flush();
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
  });

  it('refreshes an EXPIRED token, merges rotated cookies and saves', async () => {
    const newExpiry = minutes(720);
    const { provider, gateway, sessions } = setup(sessionWith(minutes(-1)), {
      refreshAccess: async () => issued({ cookies: { sid: 'r2', extra: 'e' }, refreshExpiresAt: newExpiry }),
    });
    await expect(provider.getAccessToken()).resolves.toBe('new-token');
    expect(sessions.saves).toHaveLength(1);
    const saved = sessions.saves[0]!;
    expect(saved.refresh.cookies).toEqual({ sid: 'r2', other: 'o1', extra: 'e' });
    expect(saved.refresh.expiresAt).toEqual(newExpiry);
    expect(saved.accessToken?.expiresAt).toEqual(minutes(15));
    expect(saved.establishedAt).toEqual(minutes(-60));
    expect(gateway.refreshAccess).toHaveBeenCalledWith(sessionWith(null).refresh);
  });

  it('keeps the previous expiry when cookies rotate without a new expiry', async () => {
    const { provider, sessions } = setup(sessionWith(null), {
      refreshAccess: async () => issued({ cookies: { sid: 'r2' } }),
    });
    await provider.getAccessToken();
    expect(sessions.saves[0]?.refresh.cookies).toEqual({ sid: 'r2', other: 'o1' });
    expect(sessions.saves[0]?.refresh.expiresAt).toEqual(minutes(360));
  });

  it('updates the expiry when only the expiry changes', async () => {
    const { provider, sessions } = setup(sessionWith(null), {
      refreshAccess: async () => issued({ refreshExpiresAt: minutes(600) }),
    });
    await provider.getAccessToken();
    expect(sessions.saves[0]?.refresh.cookies).toEqual({ sid: 'r1', other: 'o1' });
    expect(sessions.saves[0]?.refresh.expiresAt).toEqual(minutes(600));
  });

  it('reuses the same refresh credential when nothing rotated', async () => {
    const session = sessionWith(null);
    const { provider, sessions } = setup(session);
    await provider.getAccessToken();
    expect(sessions.saves[0]?.refresh).toBe(session.refresh);
  });

  it('invalidate() forces a refresh even with a VALID token, then resumes caching', async () => {
    const { provider, gateway } = setup(sessionWith(minutes(10)));
    provider.invalidate();
    await expect(provider.getAccessToken()).resolves.toBe('new-token');
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
    await expect(provider.getAccessToken()).resolves.toBe('new-token');
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces a blocking refresh for an ABOUT_TO_EXPIRE token', async () => {
    const { provider, gateway } = setup(sessionWith(minutes(2)));
    provider.invalidate();
    await expect(provider.getAccessToken()).resolves.toBe('new-token');
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent refreshes', async () => {
    let release: (value: ReturnType<typeof issued>) => void = () => undefined;
    const { provider, gateway, sessions } = setup(sessionWith(minutes(-1)), {
      refreshAccess: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    await flush();
    release(issued());
    await expect(Promise.all([first, second])).resolves.toEqual(['new-token', 'new-token']);
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(1);
    expect(sessions.saves).toHaveLength(1);
  });

  it('starts a new refresh after the previous one settled', async () => {
    const { provider, gateway, clock } = setup(sessionWith(minutes(-1)));
    await provider.getAccessToken();
    clock.advance(16 * 60_000);
    await provider.getAccessToken();
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(2);
  });

  it('clears the session when the refresh credential itself has expired', async () => {
    const { provider, gateway, sessions } = setup(sessionWith(minutes(-1), minutes(-1)));
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(gateway.refreshAccess).not.toHaveBeenCalled();
    expect(sessions.clears).toBe(1);
    expect(sessions.session).toBeNull();
  });

  it('clears the session when the gateway reports SessionExpiredError', async () => {
    const { provider, sessions } = setup(sessionWith(null), {
      refreshAccess: async () => {
        throw new SessionExpiredError();
      },
    });
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(sessions.clears).toBe(1);
  });

  it('does not clear the session on other errors and keeps forcing refresh', async () => {
    const failure = new UpstreamError('down', 500);
    let fail = true;
    const { provider, sessions, gateway } = setup(sessionWith(minutes(10)), {
      refreshAccess: async () => {
        if (fail) throw failure;
        return issued();
      },
    });
    provider.invalidate();
    await expect(provider.getAccessToken()).rejects.toBe(failure);
    expect(sessions.clears).toBe(0);
    expect(sessions.session).not.toBeNull();
    fail = false;
    await expect(provider.getAccessToken()).resolves.toBe('new-token');
    expect(gateway.refreshAccess).toHaveBeenCalledTimes(2);
  });

  it('propagates an invalid token from the gateway without saving', async () => {
    const { provider, sessions } = setup(sessionWith(null), {
      refreshAccess: async () => issued({ accessToken: '' }),
    });
    await expect(provider.getAccessToken()).rejects.toThrow('Access token must not be empty');
    expect(sessions.saves).toHaveLength(0);
    expect(sessions.clears).toBe(0);
  });
});
