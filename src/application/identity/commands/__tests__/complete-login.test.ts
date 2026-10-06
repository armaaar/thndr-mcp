import { describe, expect, it, vi } from 'vitest';
import {
  approvalRequest,
  awaitingApproval,
  fakeGateway,
  fakeIdentity,
  issued,
  loginDeps,
  T0,
} from '../../../../__tests__/support/identity-fakes';
import { BusinessRuleViolation } from '../../../../domain/shared-kernel/errors';
import { UpstreamError } from '../../../errors';
import { InvalidInputError } from '../../../use-case';
import { CompleteLogin } from '../complete-login';

const pending = () => fakeGateway({ getApprovalStatus: vi.fn(async () => 'pending' as const) });

describe('CompleteLogin', () => {
  it('declares its contract', () => {
    const uc = new CompleteLogin(loginDeps());
    expect(uc).toMatchObject({
      name: 'login_complete',
      kind: 'command',
      context: 'identity',
      destructive: false,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['timeoutSeconds']);
  });

  it('requires a pending approval', async () => {
    const d = loginDeps();
    await expect(new CompleteLogin(d).execute()).rejects.toBeInstanceOf(BusinessRuleViolation);
  });

  it('requires the Firebase identity', async () => {
    const d = loginDeps({ identity: fakeIdentity(null) });
    awaitingApproval(d);
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
    const d = loginDeps({ gateway, pollIntervalMs: 500 });
    awaitingApproval(d);
    const result = await new CompleteLogin(d).execute({});
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
    const d = loginDeps();
    awaitingApproval(d);
    const result = await new CompleteLogin(d).execute();
    expect(result.sessionExpiresAt).toBeNull();
  });

  it('times out while still pending and keeps the flow', async () => {
    const gateway = pending();
    const d = loginDeps({ gateway, pollIntervalMs: 1000 });
    awaitingApproval(d);
    const result = await new CompleteLogin(d).execute({ timeoutSeconds: 3 });
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

  it('clamps the timeout to [0, 300] seconds when executed directly', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'unknown' as const) });
    const d = loginDeps({ gateway, pollIntervalMs: 60_000 });
    awaitingApproval(d);
    const negative = await new CompleteLogin(d).execute({ timeoutSeconds: -5 });
    expect(negative.status).toBe('unknown');
    expect(d.sleep).not.toHaveBeenCalled();

    await new CompleteLogin(d).execute({ timeoutSeconds: 10_000 });
    expect(d.sleep).toHaveBeenCalledTimes(5);
    expect(d.sleep).toHaveBeenLastCalledWith(60_000);
  });

  it('clamps the poll interval to >= 10 ms', async () => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => 'unknown' as const) });
    const d = loginDeps({ gateway, pollIntervalMs: 1 });
    awaitingApproval(d);
    await new CompleteLogin(d).execute({ timeoutSeconds: 0.05 });
    expect(d.sleep).toHaveBeenCalledWith(10);
    expect(d.sleep).toHaveBeenCalledTimes(5);
  });

  it('uses a 60 s timeout and 1 s interval by default', async () => {
    const d = loginDeps({ gateway: pending() });
    awaitingApproval(d);
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
      const d = loginDeps({ gateway, pollIntervalMs: 20 });
      const { sleep: _sleep, ...withoutSleep } = d;
      awaitingApproval(d);
      const promise = new CompleteLogin(withoutSleep).execute();
      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toMatchObject({ authenticated: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['rejected', 'expired'] as const)('resets the flow when the request is %s', async (status) => {
    const gateway = fakeGateway({ getApprovalStatus: vi.fn(async () => status) });
    const d = loginDeps({ gateway });
    awaitingApproval(d);
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
    const d = loginDeps({ gateway });
    awaitingApproval(d);
    await expect(new CompleteLogin(d).execute()).rejects.toBeInstanceOf(UpstreamError);
    expect(d.flow.current.stage).toBe('IDLE');
    expect(d.sessions.saves).toHaveLength(0);
  });

  describe('run()', () => {
    it('defaults timeoutSeconds to 60', async () => {
      const d = loginDeps({ gateway: pending() });
      awaitingApproval(d);
      await new CompleteLogin(d).run({});
      expect(d.sleep).toHaveBeenCalledTimes(60);
    });

    it.each([
      { timeoutSeconds: -1 },
      { timeoutSeconds: 301 },
      { timeoutSeconds: 1.5 },
      { timeoutSeconds: '5' },
    ])('rejects %j', async (raw) => {
      const d = loginDeps();
      awaitingApproval(d);
      await expect(new CompleteLogin(d).run(raw)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(d.gateway.getApprovalStatus).not.toHaveBeenCalled();
    });

    it('rejects unknown fields such as pollIntervalMs', async () => {
      const d = loginDeps();
      awaitingApproval(d);
      await expect(new CompleteLogin(d).run({ pollIntervalMs: 10 })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });
  });
});
