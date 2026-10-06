import { describe, expect, it } from 'vitest';
import { AccessToken } from '../../../src/domain/identity/access-token.js';
import { RefreshCredential } from '../../../src/domain/identity/refresh-credential.js';
import { ThndrSession } from '../../../src/domain/identity/thndr-session.js';

const now = new Date('2026-01-01T00:00:00Z');
const refresh = RefreshCredential.of({ sid: 'r1' });
const token = AccessToken.of('jwt', new Date('2026-01-01T00:15:00Z'));

describe('ThndrSession', () => {
  it('establishes and restores sessions', () => {
    const established = ThndrSession.establish(refresh, token, now);
    expect(established.refresh).toBe(refresh);
    expect(established.accessToken).toBe(token);
    expect(established.establishedAt).toBe(now);
    expect(Object.isFrozen(established)).toBe(true);
    const earlier = new Date('2025-12-31T00:00:00Z');
    const restored = ThndrSession.restore(refresh, null, earlier);
    expect(restored.accessToken).toBeNull();
    expect(restored.establishedAt).toBe(earlier);
  });

  it('replaces the access token, optionally rotating the refresh credential', () => {
    const session = ThndrSession.establish(refresh, null, now);
    const withToken = session.withAccessToken(token);
    expect(withToken.accessToken).toBe(token);
    expect(withToken.refresh).toBe(refresh);
    expect(withToken.establishedAt).toBe(now);
    const rotated = RefreshCredential.of({ sid: 'r2' });
    expect(session.withAccessToken(token, rotated).refresh).toBe(rotated);
    expect(session.accessToken).toBeNull();
  });

  it('drops the access token', () => {
    const session = ThndrSession.establish(refresh, token, now).withoutAccessToken();
    expect(session.accessToken).toBeNull();
    expect(session.refresh).toBe(refresh);
    expect(session.establishedAt).toBe(now);
  });

  it('only returns a VALID cached token', () => {
    const session = ThndrSession.establish(refresh, token, now);
    expect(session.usableAccessToken(now)).toBe(token);
    expect(session.usableAccessToken(new Date('2026-01-01T00:13:00Z'))).toBeNull();
    expect(session.usableAccessToken(new Date('2026-01-01T00:16:00Z'))).toBeNull();
    expect(ThndrSession.establish(refresh, null, now).usableAccessToken(now)).toBeNull();
  });
});
