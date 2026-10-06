import { describe, expect, it, vi } from 'vitest';
import { fakeGateway, issued, loginDeps, T0 } from '../../../../__tests__/support/identity-fakes';
import { RefreshCredential } from '../../../../domain/identity/refresh-credential';
import { InvalidInputError } from '../../../use-case';
import { ImportSession } from '../import-session';

describe('ImportSession', () => {
  it('declares its contract', () => {
    const uc = new ImportSession(loginDeps());
    expect(uc).toMatchObject({
      name: 'login_import_session',
      kind: 'command',
      context: 'identity',
      destructive: false,
      idempotent: false,
    });
    expect(Object.keys(uc.input)).toEqual(['cookieHeader']);
  });

  it('refreshes with the imported cookies and saves the merged session', async () => {
    const refreshExpiresAt = new Date('2026-01-01T06:00:00Z');
    const gateway = fakeGateway({
      refreshAccess: vi.fn(async () => issued({ cookies: { sid: 'rotated' }, refreshExpiresAt })),
    });
    const d = loginDeps({ gateway });
    const result = await new ImportSession(d).execute({ cookieHeader: ' sid=abc; theme=dark ' });
    expect(gateway.refreshAccess).toHaveBeenCalledWith(RefreshCredential.of({ sid: 'abc', theme: 'dark' }));
    expect(result).toEqual({ authenticated: true, accessTokenExpiresAt: '2026-01-01T00:15:00.000Z' });
    const saved = d.sessions.session!;
    expect(saved.refresh.cookies).toEqual({ sid: 'rotated', theme: 'dark' });
    expect(saved.refresh.expiresAt).toEqual(refreshExpiresAt);
    expect(saved.establishedAt).toEqual(T0);
  });

  it('rejects an empty Cookie header', async () => {
    const d = loginDeps();
    await expect(new ImportSession(d).execute({ cookieHeader: '  ' })).rejects.toThrow(
      'Cookie header must not be empty',
    );
  });

  it('validates input in run()', async () => {
    const d = loginDeps();
    const uc = new ImportSession(d);
    await expect(uc.run({ cookieHeader: 'a' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ cookie_header: 'sid=abc' })).rejects.toBeInstanceOf(InvalidInputError);
    expect(d.gateway.refreshAccess).not.toHaveBeenCalled();
    await expect(uc.run({ cookieHeader: 'sid=abc' })).resolves.toMatchObject({ authenticated: true });
  });
});
