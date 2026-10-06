import { describe, expect, it } from 'vitest';
import { awaitingApproval, fakeIdentity, loginDeps, T0 } from '../../../../__tests__/support/identity-fakes';
import { AccessToken } from '../../../../domain/identity/access-token';
import { Email } from '../../../../domain/identity/email';
import { RefreshCredential } from '../../../../domain/identity/refresh-credential';
import { ThndrSession } from '../../../../domain/identity/thndr-session';
import { InvalidInputError } from '../../../use-case';
import { GetAuthStatus } from '../get-auth-status';

describe('GetAuthStatus', () => {
  it('declares its contract', () => {
    const uc = new GetAuthStatus(loginDeps());
    expect(uc).toMatchObject({
      name: 'auth_status',
      kind: 'query',
      context: 'identity',
      title: 'Thndr session status',
      local: true,
    });
    expect(uc.input).toEqual({});
  });

  it('reports a fresh, unauthenticated state', async () => {
    const d = loginDeps({ identity: fakeIdentity(null) });
    await expect(new GetAuthStatus(d).execute()).resolves.toEqual({
      authenticated: false,
      identified: false,
      pendingStep: 'none',
      accessTokenExpiresAt: null,
      sessionExpiresAt: null,
      sessionEstablishedAt: null,
    });
  });

  it('reports an authenticated session awaiting nothing', async () => {
    const d = loginDeps();
    d.sessions.session = ThndrSession.establish(
      RefreshCredential.of({ sid: 'r1' }, new Date('2026-01-01T06:00:00Z')),
      AccessToken.of('tok', new Date('2026-01-01T00:15:00Z')),
      T0,
    );
    void d.flow.save(d.flow.current.codeSent(Email.of('a@example.com'), 'v1'));
    await expect(new GetAuthStatus(d).execute()).resolves.toEqual({
      authenticated: true,
      identified: true,
      pendingStep: 'verify_code',
      accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
      sessionExpiresAt: '2026-01-01T06:00:00.000Z',
      sessionEstablishedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('treats an expired refresh credential as unauthenticated and identity errors as unidentified', async () => {
    const identity = fakeIdentity();
    identity.getIdToken.mockRejectedValue(new Error('offline'));
    const d = loginDeps({ identity });
    d.sessions.session = ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }, T0), null, T0);
    awaitingApproval(d);
    await expect(new GetAuthStatus(d).execute()).resolves.toMatchObject({
      authenticated: false,
      identified: false,
      pendingStep: 'approve_on_phone',
      accessTokenExpiresAt: null,
      sessionExpiresAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('validates input in run()', async () => {
    const uc = new GetAuthStatus(loginDeps());
    await expect(uc.run({ verbose: true })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(uc.run({})).resolves.toMatchObject({ pendingStep: 'none' });
  });
});
