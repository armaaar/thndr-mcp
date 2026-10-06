import { afterEach, describe, expect, it } from 'vitest';
import type * as L from '../../../src/application/identity/login.js';
import { identityTools } from '../../../src/interface/mcp/identity-tools.js';
import { type ConnectedClient, connect } from '../../support/mcp-client.js';
import { stub } from '../../support/use-case-stub.js';

function useCases() {
  return {
    getAuthStatus: stub<L.GetAuthStatus>({ authenticated: false }),
    startLogin: stub<L.StartLogin>({ maskedEmail: 'a***@b.co' }),
    verifyLoginCode: stub<L.VerifyLoginCode>({ deepLink: 'thndr://x' }),
    requestDeviceApproval: stub<L.RequestDeviceApproval>({ deepLink: 'thndr://y' }),
    completeLogin: stub<L.CompleteLogin>({ authenticated: true }),
    importSession: stub<L.ImportSession>({ authenticated: true }),
    logout: stub<L.Logout>({ loggedOut: true }),
  };
}

describe('identity tools', () => {
  let conn: ConnectedClient;
  afterEach(async () => conn?.close());

  it('exposes the login flow tools and maps arguments to use cases', async () => {
    const uc = useCases();
    conn = await connect(identityTools(uc));
    const names = (await conn.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      'auth_status',
      'login_start',
      'login_verify_code',
      'login_request_approval',
      'login_complete',
      'login_import_session',
      'logout',
    ]);

    expect((await conn.call('auth_status')).json).toEqual({ authenticated: false });
    await conn.call('login_start', { email: 'a@b.co' });
    expect(uc.startLogin.execute).toHaveBeenCalledWith({ email: 'a@b.co' });
    await conn.call('login_verify_code', { code: '123456' });
    expect(uc.verifyLoginCode.execute).toHaveBeenCalledWith({ code: '123456' });
    expect((await conn.call('login_request_approval')).json).toEqual({ deepLink: 'thndr://y' });
    await conn.call('login_complete', {});
    expect(uc.completeLogin.execute).toHaveBeenCalledWith({ timeoutSeconds: 60 });
    await conn.call('login_complete', { timeout_seconds: 5 });
    expect(uc.completeLogin.execute).toHaveBeenLastCalledWith({ timeoutSeconds: 5 });
    await conn.call('login_import_session', { cookie_header: 'a=1; b=2' });
    expect(uc.importSession.execute).toHaveBeenCalledWith({ cookieHeader: 'a=1; b=2' });
    await conn.call('logout', {});
    expect(uc.logout.execute).toHaveBeenCalledWith({ forgetIdentity: false });
    await conn.call('logout', { forget_identity: true });
    expect(uc.logout.execute).toHaveBeenLastCalledWith({ forgetIdentity: true });
  });

  it('rejects out-of-range timeouts before calling the use case', async () => {
    const uc = useCases();
    conn = await connect(identityTools(uc));
    const res = await conn.call('login_complete', { timeout_seconds: 9999 });
    expect(res.isError).toBe(true);
    expect(uc.completeLogin.execute).not.toHaveBeenCalled();
  });
});
