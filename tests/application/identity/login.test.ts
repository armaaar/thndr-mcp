import { describe, expect, it, vi } from 'vitest';
import { NotAuthenticatedError, UpstreamError } from '../../../src/application/errors.js';
import {
  CompleteLogin,
  GetAuthStatus,
  ImportSession,
  type LoginDependencies,
  Logout,
  RequestDeviceApproval,
  StartLogin,
  VerifyLoginCode,
} from '../../../src/application/identity/login.js';
import { LoginFlowHolder } from '../../../src/application/identity/login-flow-holder.js';
import { AccessToken } from '../../../src/domain/identity/access-token.js';
import { DeviceApprovalRequest } from '../../../src/domain/identity/device-approval.js';
import { Email } from '../../../src/domain/identity/email.js';
import { RefreshCredential } from '../../../src/domain/identity/refresh-credential.js';
import { ThndrSession } from '../../../src/domain/identity/thndr-session.js';
import { BusinessRuleViolation, ValidationError } from '../../../src/domain/shared-kernel/errors.js';
import {
  approvalRequest,
  fakeGateway,
  fakeIdentity,
  InMemorySessionRepository,
  issued,
  mutableClock,
  T0,
} from '../../support/identity-fakes.js';

const USER_AGENT = 'thndr-mcp/0.1.0';

function deps(
  overrides: { gateway?: ReturnType<typeof fakeGateway>; identity?: ReturnType<typeof fakeIdentity> } = {},
) {
  const clock = mutableClock();
  return {
    gateway: overrides.gateway ?? fakeGateway(),
    identity: overrides.identity ?? fakeIdentity(),
    sessions: new InMemorySessionRepository(),
    flow: new LoginFlowHolder(),
    clock,
    sleep: vi.fn(async (ms: number) => clock.advance(ms)),
    userAgent: USER_AGENT,
  } satisfies LoginDependencies;
}

function awaiting(d: ReturnType<typeof deps>, request: DeviceApprovalRequest = approvalRequest) {
  d.flow.set(d.flow.current.awaitingApproval(request));
}

describe('StartLogin', () => {
  it('mails the code and moves to CODE_SENT', async () => {
    const d = deps();
    const result = await new StartLogin(d).execute({ email: ' Ahmed@Example.com ' });
    expect(d.gateway.sendEmailCode).toHaveBeenCalledWith('ahmed@example.com');
    expect(result.maskedEmail).toBe('a***@example.com');
    expect(result.message).toContain('a***@example.com');
    expect(result.message).toContain('login_verify_code');
    expect(d.flow.current.requireCodeSent()).toEqual({
      email: Email.of('ahmed@example.com'),
      verificationId: 'verification-1',
    });
  });

  it('rejects invalid emails before calling Thndr', async () => {
    const d = deps();
    await expect(new StartLogin(d).execute({ email: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    expect(d.gateway.sendEmailCode).not.toHaveBeenCalled();
  });
});

describe('VerifyLoginCode', () => {
  function codeSent() {
    const d = deps();
    d.flow.set(d.flow.current.codeSent(Email.of('a@example.com'), 'verification-1'));
    return d;
  }

  it('verifies the code, signs in to Firebase and requests approval', async () => {
    const d = codeSent();
    const result = await new VerifyLoginCode(d).execute({ code: ' 123 456 ' });
    expect(d.gateway.verifyEmailCode).toHaveBeenCalledWith('verification-1', '123456');
    expect(d.identity.signInWithCustomToken).toHaveBeenCalledWith('custom-token');
    expect(d.gateway.createApprovalRequest).toHaveBeenCalledWith('id-token');
    expect(result).toEqual({
      humanId: '4242',
      requestId: 'req-1',
      deepLink: approvalRequest.deepLink(USER_AGENT),
      message:
        'Open the Thndr app on your phone and approve the new login request (code 4242), or open the deep ' +
        'link on the phone. Then call login_complete.',
    });
    expect(d.flow.current.stage).toBe('AWAITING_APPROVAL');
    expect(d.flow.current.email?.value).toBe('a@example.com');
  });

  it.each(['', '   ', '12a456', '123', '123456789'])('rejects code %j', async (code) => {
    const d = codeSent();
    await expect(new VerifyLoginCode(d).execute({ code })).rejects.toBeInstanceOf(ValidationError);
    expect(d.gateway.verifyEmailCode).not.toHaveBeenCalled();
  });

  it('requires login_start first', async () => {
    const d = deps();
    await expect(new VerifyLoginCode(d).execute({ code: '123456' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
  });
});

describe('RequestDeviceApproval', () => {
  it('requires a Firebase identity', async () => {
    const d = deps({ identity: fakeIdentity(null) });
    await expect(new RequestDeviceApproval(d).execute()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(d.gateway.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('omits the code from the message when there is no human id', async () => {
    const request = DeviceApprovalRequest.of({ id: 'r2', secret: 's2', humanId: '', createdAt: T0 });
    const d = deps({ gateway: fakeGateway({ createApprovalRequest: async () => request }) });
    const result = await new RequestDeviceApproval(d).execute();
    expect(result.message).toBe(
      'Open the Thndr app on your phone and approve the new login request, or open the deep link on the ' +
        'phone. Then call login_complete.',
    );
    expect(d.flow.current.requireAwaitingApproval()).toBe(request);
  });
});

describe('CompleteLogin', () => {
  it('requires a pending approval', async () => {
    const d = deps();
    await expect(new CompleteLogin(d).execute()).rejects.toBeInstanceOf(BusinessRuleViolation);
  });

  it('requires the Firebase identity', async () => {
    const d = deps({ identity: fakeIdentity(null) });
    awaiting(d);
    await expect(new CompleteLogin(d).execute()).rejects.toThrow('Firebase identity lost');
  });

  it('polls until approved, exchanges and persists the session', async () => {
    const refreshExpiresAt = new Date(T0.getTime() + 6 * 3_600_000);
    const statuses = ['pending', 'unknown', 'approved'] as const;
    let i = 0;
    const gateway = fakeGateway({
      getApprovalStatus: vi.fn(async () => statuses[i++] ?? 'approved'),
      exchangeApproval: vi.fn(async () => issued({ cookies: { sid: 'r1' }, refreshExpiresAt })),
    });
    const d = deps({ gateway });
    awaiting(d);
    const result = await new CompleteLogin(d).execute({ pollIntervalMs: 500 });
    expect(gateway.getApprovalStatus).toHaveBeenCalledTimes(3);
    expect(gateway.getApprovalStatus).toHaveBeenCalledWith(approvalRequest, 'id-token');
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(500);
    expect(gateway.exchangeApproval).toHaveBeenCalledWith(approvalRequest, 'id-token');
    expect(result).toEqual({
      status: 'approved',
      authenticated: true,
      message: 'Logged in to Thndr.',
      accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
      sessionExpiresAt: '2026-01-01T06:00:00.000Z',
    });
    const saved = d.sessions.session!;
    expect(saved.refresh.cookies).toEqual({ sid: 'r1' });
    expect(saved.refresh.expiresAt).toEqual(refreshExpiresAt);
    expect(saved.accessToken?.value).toBe('new-token');
    expect(saved.establishedAt).toEqual(new Date(T0.getTime() + 1000));
    expect(d.flow.current.stage).toBe('IDLE');
  });

  it('reports a null session expiry when unknown', async () => {
    const d = deps();
    awaiting(d);
    const result = await new CompleteLogin(d).execute();
    expect(result.sessionExpiresAt).toBeNull();
  });

  it('times out while still pending and keeps the flow', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'pending' as const) });
    const d = deps({ gateway });
    awaiting(d);
    const result = await new CompleteLogin(d).execute({ timeoutSeconds: 3, pollIntervalMs: 1000 });
    expect(result).toEqual({
      status: 'pending',
      authenticated: false,
      message: 'Still waiting for approval in the Thndr app. Approve it, then call login_complete again.',
    });
    expect(d.sleep).toHaveBeenCalledTimes(3);
    expect(gateway.getApprovalStatus).toHaveBeenCalledTimes(4);
    expect(d.flow.current.stage).toBe('AWAITING_APPROVAL');
    expect(gateway.exchangeApproval).not.toHaveBeenCalled();
  });

  it('clamps the timeout to [0, 300] seconds and the interval to >= 10 ms', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'unknown' as const) });
    const d = deps({ gateway });
    awaiting(d);
    const negative = await new CompleteLogin(d).execute({ timeoutSeconds: -5 });
    expect(negative.status).toBe('unknown');
    expect(d.sleep).not.toHaveBeenCalled();

    await new CompleteLogin(d).execute({ timeoutSeconds: 10_000, pollIntervalMs: 60_000 });
    expect(d.sleep).toHaveBeenCalledTimes(5);
    expect(d.sleep).toHaveBeenLastCalledWith(60_000);

    d.sleep.mockClear();
    await new CompleteLogin(d).execute({ timeoutSeconds: 0.05, pollIntervalMs: 1 });
    expect(d.sleep).toHaveBeenCalledWith(10);
    expect(d.sleep).toHaveBeenCalledTimes(5);
  });

  it('uses a 60 s timeout and 1 s interval by default', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'pending' as const) });
    const d = deps({ gateway });
    awaiting(d);
    await new CompleteLogin(d).execute();
    expect(d.sleep).toHaveBeenCalledTimes(60);
    expect(d.sleep).toHaveBeenCalledWith(1000);
  });

  it('falls back to a real timer when no sleep is injected', async () => {
    vi.useFakeTimers();
    try {
      let i = 0;
      const gateway = fakeGateway({
        getApprovalStatus: vi.fn(async () => (i++ === 0 ? ('pending' as const) : ('approved' as const))),
      });
      const d = deps({ gateway });
      const { sleep: _sleep, ...withoutSleep } = d;
      awaiting(d);
      const promise = new CompleteLogin(withoutSleep).execute({ pollIntervalMs: 20 });
      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toMatchObject({ authenticated: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['rejected', 'expired'] as const)('resets the flow when the request is %s', async (status) => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => status) });
    const d = deps({ gateway });
    awaiting(d);
    const result = await new CompleteLogin(d).execute();
    expect(result).toEqual({
      status,
      authenticated: false,
      message: `The login request was ${status}. Call login_request_approval to try again.`,
    });
    expect(d.flow.current.stage).toBe('IDLE');
    expect(gateway.exchangeApproval).not.toHaveBeenCalled();
  });

  it('rejects an already claimed approval', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'claimed' as const) });
    const d = deps({ gateway });
    awaiting(d);
    await expect(new CompleteLogin(d).execute()).rejects.toBeInstanceOf(UpstreamError);
    expect(d.flow.current.stage).toBe('IDLE');
    expect(d.sessions.saves).toHaveLength(0);
  });
});

describe('ImportSession', () => {
  it('refreshes with the imported cookies and saves the merged session', async () => {
    const refreshExpiresAt = new Date('2026-01-01T06:00:00Z');
    const gateway = fakeGateway({
      refreshAccess: vi.fn(async () => issued({ cookies: { sid: 'rotated' }, refreshExpiresAt })),
    });
    const d = deps({ gateway });
    const result = await new ImportSession(d).execute({ cookieHeader: ' sid=abc; theme=dark ' });
    expect(gateway.refreshAccess).toHaveBeenCalledWith(RefreshCredential.of({ sid: 'abc', theme: 'dark' }));
    expect(result).toEqual({ authenticated: true, accessTokenExpiresAt: '2026-01-01T00:15:00.000Z' });
    const saved = d.sessions.session!;
    expect(saved.refresh.cookies).toEqual({ sid: 'rotated', theme: 'dark' });
    expect(saved.refresh.expiresAt).toEqual(refreshExpiresAt);
    expect(saved.establishedAt).toEqual(T0);
  });

  it('rejects an empty Cookie header', async () => {
    const d = deps();
    await expect(new ImportSession(d).execute({ cookieHeader: '  ' })).rejects.toThrow(
      'Cookie header must not be empty',
    );
  });
});

describe('GetAuthStatus', () => {
  it('reports a fresh, unauthenticated state', async () => {
    const d = deps({ identity: fakeIdentity(null) });
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
    const d = deps();
    d.sessions.session = ThndrSession.establish(
      RefreshCredential.of({ sid: 'r1' }, new Date('2026-01-01T06:00:00Z')),
      AccessToken.of('tok', new Date('2026-01-01T00:15:00Z')),
      T0,
    );
    d.flow.set(d.flow.current.codeSent(Email.of('a@example.com'), 'v1'));
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
    const d = deps({ identity });
    d.sessions.session = ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }, T0), null, T0);
    awaiting(d);
    await expect(new GetAuthStatus(d).execute()).resolves.toMatchObject({
      authenticated: false,
      identified: false,
      pendingStep: 'approve_on_phone',
      accessTokenExpiresAt: null,
      sessionExpiresAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('Logout', () => {
  function withSession() {
    const d = deps();
    d.sessions.session = ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }), null, T0);
    awaiting(d);
    return d;
  }

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
    const d = deps();
    await new Logout(d).execute();
    expect(d.gateway.logout).not.toHaveBeenCalled();
    expect(d.sessions.clears).toBe(0);
  });
});
