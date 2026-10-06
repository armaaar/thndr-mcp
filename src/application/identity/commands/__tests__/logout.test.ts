import { describe, expect, it } from 'vitest';
import { awaitingApproval, loginDeps, T0 } from '../../../../__tests__/support/identity-fakes';
import { RefreshCredential } from '../../../../domain/identity/refresh-credential';
import { ThndrSession } from '../../../../domain/identity/thndr-session';
import { UpstreamError } from '../../../errors';
import { InvalidInputError } from '../../../use-case';
import { Logout } from '../logout';

function withSession() {
  const d = loginDeps();
  d.sessions.session = ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }), null, T0);
  awaitingApproval(d);
  return d;
}

describe('Logout', () => {
  it('declares its contract', () => {
    const uc = new Logout(loginDeps());
    expect(uc).toMatchObject({
      name: 'logout',
      kind: 'command',
      context: 'identity',
      destructive: true,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['forgetIdentity']);
  });

  it('logs out upstream, clears the session and resets the flow', async () => {
    const d = withSession();
    const refresh = d.sessions.session!.refresh;
    await expect(new Logout(d).execute()).resolves.toEqual({ loggedOut: true });
    expect(d.gateway.logout).toHaveBeenCalledWith(refresh);
    expect(d.sessions.clears).toBe(1);
    expect(d.identity.signOut).not.toHaveBeenCalled();
    expect(d.flow.current.stage).toBe('IDLE');
  });

  it('still clears locally when Thndr is unreachable, and can forget the identity', async () => {
    const d = withSession();
    d.gateway.logout.mockRejectedValue(new UpstreamError('down'));
    await new Logout(d).execute({ forgetIdentity: true });
    expect(d.sessions.clears).toBe(1);
    expect(d.identity.signOut).toHaveBeenCalledTimes(1);
  });

  it('does nothing upstream without a session', async () => {
    const d = loginDeps();
    await new Logout(d).execute();
    expect(d.gateway.logout).not.toHaveBeenCalled();
    expect(d.sessions.clears).toBe(0);
  });

  it('validates input in run() and defaults forgetIdentity to false', async () => {
    const d = withSession();
    const uc = new Logout(d);
    await expect(uc.run({ forgetIdentity: 'yes' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ forget_identity: true })).rejects.toBeInstanceOf(InvalidInputError);
    expect(d.sessions.clears).toBe(0);
    await expect(uc.run({})).resolves.toEqual({ loggedOut: true });
    expect(d.identity.signOut).not.toHaveBeenCalled();
    await uc.run({ forgetIdentity: true });
    expect(d.identity.signOut).toHaveBeenCalledTimes(1);
  });
});
