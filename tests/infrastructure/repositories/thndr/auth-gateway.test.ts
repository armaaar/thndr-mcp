import { describe, expect, it } from 'vitest';
import { SessionExpiredError, UpstreamError } from '../../../../src/application/errors';
import { DeviceApprovalRequest } from '../../../../src/domain/identity/device-approval';
import { RefreshCredential } from '../../../../src/domain/identity/refresh-credential';
import { ThndrHttpClient } from '../../../../src/infrastructure/data-sources/thndr/http-client';
import {
  HttpThndrAuthGateway,
  THNDRX_SCOPES,
} from '../../../../src/infrastructure/repositories/thndr/auth-gateway';
import { fakeFetch, json, type Responder } from '../../../support/fake-fetch';

const now = new Date('2026-01-01T00:00:00Z');
const clock = { now: () => now };
const request = DeviceApprovalRequest.of({ id: 'req/1', secret: 'sec', humanId: '42', createdAt: now });
const refresh = RefreshCredential.of({ sid: 'r1', other: 'o1' });

function setup(responder: Responder, platform?: 'thndrx_web' | 'thndrx_mobile') {
  const fetch = fakeFetch(responder);
  const client = (baseUrl: string) =>
    new ThndrHttpClient({ baseUrl, fetch, runtimeVersion: '3.8.3', correlationId: () => 'cid' });
  const gateway = new HttpThndrAuthGateway(
    client('https://prod.thndr.app'),
    client('https://x.thndr.app/api'),
    clock,
    platform,
  );
  return { fetch, gateway };
}

function withCookies(body: unknown, cookies: string[], status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: [
      ['content-type', 'application/json'],
      ...cookies.map((c): [string, string] => ['set-cookie', c]),
    ],
  });
}

const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('HttpThndrAuthGateway', () => {
  describe('sendEmailCode', () => {
    it('posts the email unauthenticated and returns the verification id', async () => {
      const { fetch, gateway } = setup(() => json({ id: 'v1' }));
      await expect(gateway.sendEmailCode('a@example.com')).resolves.toBe('v1');
      expect(fetch.calls).toHaveLength(1);
      const call = fetch.calls[0]!;
      expect(call.method).toBe('POST');
      expect(call.url).toBe('https://prod.thndr.app/auth-service/v2/users/email-code');
      expect(call.body).toEqual({ email: 'a@example.com' });
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers['x-correlation-id']).toBe('cid');
    });

    it.each([{}, { id: '' }, { id: null }])('fails on a missing id (%j)', async (body) => {
      const { gateway } = setup(() => json(body));
      await expect(gateway.sendEmailCode('a@example.com')).rejects.toThrow(
        new UpstreamError('Unexpected Thndr response: missing verification id'),
      );
    });

    it('fails on an empty body', async () => {
      const { gateway } = setup(() => json(undefined));
      await expect(gateway.sendEmailCode('a@example.com')).rejects.toBeInstanceOf(UpstreamError);
    });
  });

  describe('verifyEmailCode', () => {
    it('posts id + code and returns the firebase custom token', async () => {
      const { fetch, gateway } = setup(() => json({ firebase_auth_token: 'ct' }));
      await expect(gateway.verifyEmailCode('v1', '123456')).resolves.toBe('ct');
      expect(fetch.calls[0]).toMatchObject({
        method: 'POST',
        url: 'https://prod.thndr.app/auth-service/v2/users/login',
        body: { id: 'v1', code: '123456' },
      });
    });

    it('fails when the token is missing', async () => {
      const { gateway } = setup(() => json({}));
      await expect(gateway.verifyEmailCode('v1', '1')).rejects.toThrow('missing firebase_auth_token');
    });
  });

  describe('createApprovalRequest', () => {
    it('requests the ThndrX scopes with the firebase token', async () => {
      const { fetch, gateway } = setup(() => json({ id: 'r1', request_secret: 's1', human_id: 1234 }));
      const result = await gateway.createApprovalRequest('fb');
      expect(result).toMatchObject({ id: 'r1', secret: 's1', humanId: '1234', createdAt: now });
      expect(fetch.calls[0]).toMatchObject({
        method: 'POST',
        url: 'https://prod.thndr.app/auth-service/tokens/request',
        body: { data: { scopes: [...THNDRX_SCOPES] }, credentials: { firebase_token: 'fb' } },
      });
      expect(THNDRX_SCOPES).toContain('order:write');
      expect(THNDRX_SCOPES).toHaveLength(30);
    });

    it('defaults a missing human id to an empty string', async () => {
      const { gateway } = setup(() => json({ id: 'r1', request_secret: 's1' }));
      expect((await gateway.createApprovalRequest('fb')).humanId).toBe('');
    });

    it.each([
      [{ request_secret: 's1' }, 'missing token request id'],
      [{ id: 'r1' }, 'missing request_secret'],
    ])('fails on %j', async (body, message) => {
      const { gateway } = setup(() => json(body));
      await expect(gateway.createApprovalRequest('fb')).rejects.toThrow(message);
    });
  });

  describe('getApprovalStatus', () => {
    it('posts the secret to the encoded status URL and parses the status', async () => {
      const { fetch, gateway } = setup(() => json({ status: 'APPROVED' }));
      await expect(gateway.getApprovalStatus(request, 'fb')).resolves.toBe('approved');
      expect(fetch.calls[0]).toMatchObject({
        method: 'POST',
        url: 'https://prod.thndr.app/auth-service/tokens/request/req%2F1/status',
        body: { data: { request_secret: 'sec' }, credentials: { firebase_token: 'fb' } },
      });
    });

    it('maps an empty body to unknown', async () => {
      const { gateway } = setup(() => json(undefined));
      await expect(gateway.getApprovalStatus(request, 'fb')).resolves.toBe('unknown');
    });
  });

  describe('exchangeApproval', () => {
    it('exchanges at /api/auth/login and captures cookies and expiries', async () => {
      const { fetch, gateway } = setup(() =>
        withCookies(
          { auth_token: 'access', auth_token_expires_at: 1767226500, refresh_token_expires_at: '1767247200' },
          ['sid=r1; Path=/; HttpOnly; Max-Age=60', 'b=2'],
        ),
      );
      const issued = await gateway.exchangeApproval(request, 'fb');
      expect(issued).toEqual({
        accessToken: 'access',
        accessTokenExpiresAt: new Date('2026-01-01T00:15:00Z'),
        cookies: { sid: 'r1', b: '2' },
        refreshExpiresAt: new Date('2026-01-01T06:00:00Z'),
      });
      const call = fetch.calls[0]!;
      expect(call.method).toBe('POST');
      expect(call.url).toBe('https://x.thndr.app/api/auth/login');
      expect(call.body).toEqual({
        request_id: 'req/1',
        request_secret: 'sec',
        firebase_token: 'fb',
        platform: 'thndrx_web',
      });
      expect(call.headers.authorization).toBeUndefined();
    });

    it('sends the configured platform', async () => {
      const { fetch, gateway } = setup(() => withCookies({ auth_token: 'a' }, ['sid=1']), 'thndrx_mobile');
      await gateway.exchangeApproval(request, 'fb');
      expect((fetch.calls[0]!.body as { platform: string }).platform).toBe('thndrx_mobile');
    });

    it('fails when no refresh cookie was set', async () => {
      const { gateway } = setup(() => json({ auth_token: 'access' }));
      await expect(gateway.exchangeApproval(request, 'fb')).rejects.toThrow(
        new UpstreamError('Thndr login succeeded but no refresh cookie was set'),
      );
    });

    it('fails when only deleted or malformed cookies were set', async () => {
      const { gateway } = setup(() => withCookies({ auth_token: 'a' }, ['gone=; Max-Age=0', 'junk']));
      await expect(gateway.exchangeApproval(request, 'fb')).rejects.toThrow('no refresh cookie');
    });

    it('fails without an auth_token', async () => {
      const { gateway } = setup(() => withCookies({}, ['sid=1']));
      await expect(gateway.exchangeApproval(request, 'fb')).rejects.toThrow('missing auth_token');
    });
  });

  describe('refreshAccess', () => {
    it('posts to /api/auth/refresh with the cookie header', async () => {
      const { fetch, gateway } = setup(() => json({ auth_token: 'access' }));
      const issued = await gateway.refreshAccess(refresh);
      expect(issued).toEqual({
        accessToken: 'access',
        accessTokenExpiresAt: new Date('2026-01-01T00:15:00Z'),
        cookies: {},
        refreshExpiresAt: null,
      });
      const call = fetch.calls[0]!;
      expect(call.method).toBe('POST');
      expect(call.url).toBe('https://x.thndr.app/api/auth/refresh');
      expect(call.headers.cookie).toBe('sid=r1; other=o1');
      expect(call.body).toBeUndefined();
      expect(call.headers.authorization).toBeUndefined();
    });

    it('falls back to the JWT exp, then the default TTL, for the access token expiry', async () => {
      const { gateway } = setup(() => json({ auth_token: jwt({ exp: 1767225900 }) }));
      expect((await gateway.refreshAccess(refresh)).accessTokenExpiresAt).toEqual(
        new Date('2026-01-01T00:05:00Z'),
      );
      const noExp = setup(() => json({ auth_token: jwt({ sub: 'u' }), auth_token_expires_at: 'garbage' }));
      expect((await noExp.gateway.refreshAccess(refresh)).accessTokenExpiresAt).toEqual(
        new Date('2026-01-01T00:15:00Z'),
      );
    });

    it('prefers auth_token_expires_at over the JWT exp', async () => {
      const { gateway } = setup(() =>
        json({ auth_token: jwt({ exp: 1767225900 }), auth_token_expires_at: '2026-01-01T00:10:00Z' }),
      );
      expect((await gateway.refreshAccess(refresh)).accessTokenExpiresAt).toEqual(
        new Date('2026-01-01T00:10:00Z'),
      );
    });

    it('derives the refresh expiry from the latest cookie expiry and ignores deleted cookies', async () => {
      const { gateway } = setup(() =>
        withCookies({ auth_token: 'a' }, [
          'sid=r2; Max-Age=3600',
          'late=x; Expires=Thu, 01 Jan 2026 06:00:00 GMT',
          'mid=y; Max-Age=60',
          'plain=z',
          'old=; Max-Age=0',
          'stale=v; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        ]),
      );
      const issued = await gateway.refreshAccess(refresh);
      expect(issued.cookies).toEqual({ sid: 'r2', late: 'x', mid: 'y', plain: 'z' });
      expect(issued.refreshExpiresAt).toEqual(new Date('2026-01-01T06:00:00Z'));
    });

    it('prefers refresh_token_expires_at over cookie expiries', async () => {
      const { gateway } = setup(() =>
        withCookies({ auth_token: 'a', refresh_token_expires_at: 1767232800 }, ['sid=r2; Max-Age=60']),
      );
      expect((await gateway.refreshAccess(refresh)).refreshExpiresAt).toEqual(
        new Date('2026-01-01T02:00:00Z'),
      );
    });

    it.each(['MISSING_REFRESH_TOKEN', 'INVALID_REFRESH_TOKEN', 'EXPIRED_REFRESH_TOKEN'])(
      'maps 400 %s to SessionExpiredError',
      async (type) => {
        const { gateway } = setup(() => json({ type }, 400));
        await expect(gateway.refreshAccess(refresh)).rejects.toBeInstanceOf(SessionExpiredError);
      },
    );

    it('maps 401 to SessionExpiredError', async () => {
      const { gateway } = setup(() => json({ message: 'nope' }, 401));
      await expect(gateway.refreshAccess(refresh)).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('re-throws other upstream errors', async () => {
      const { gateway } = setup(() => json({ type: 'RATE_LIMITED' }, 429));
      const error = await gateway.refreshAccess(refresh).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).not.toBeInstanceOf(SessionExpiredError);
      expect((error as UpstreamError).status).toBe(429);
      expect((error as UpstreamError).upstreamCode).toBe('RATE_LIMITED');
    });

    it('re-throws upstream errors without a code', async () => {
      const { gateway } = setup(() => json(undefined, 500));
      await expect(gateway.refreshAccess(refresh)).rejects.toMatchObject({
        status: 500,
        upstreamCode: undefined,
      });
    });

    it('re-throws network errors', async () => {
      const { gateway } = setup(() => {
        throw new TypeError('fetch failed');
      });
      await expect(gateway.refreshAccess(refresh)).rejects.toThrow('Network error calling Thndr');
    });

    it('re-throws a missing auth_token as an UpstreamError, not a session expiry', async () => {
      const { gateway } = setup(() => json({}));
      const error = await gateway.refreshAccess(refresh).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).not.toBeInstanceOf(SessionExpiredError);
      expect((error as Error).message).toContain('missing auth_token');
    });

    it('re-throws non-upstream errors unchanged', async () => {
      const failure = new RangeError('body stream broke');
      const broken = {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => {
          throw failure;
        },
      } as unknown as Response;
      const { gateway } = setup(() => broken);
      await expect(gateway.refreshAccess(refresh)).rejects.toBe(failure);
    });
  });

  describe('logout', () => {
    it('sends DELETE /api/auth/logout with the cookie header', async () => {
      const { fetch, gateway } = setup(() => new Response(null, { status: 204 }));
      await expect(gateway.logout(refresh)).resolves.toBeUndefined();
      expect(fetch.calls[0]).toMatchObject({
        method: 'DELETE',
        url: 'https://x.thndr.app/api/auth/logout',
        headers: expect.objectContaining({ cookie: 'sid=r1; other=o1' }),
      });
      expect(fetch.calls[0]?.headers.authorization).toBeUndefined();
    });
  });
});
