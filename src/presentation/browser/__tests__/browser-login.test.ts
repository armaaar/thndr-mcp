import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL,
  APPROVED,
  identityUseCases,
  type LoginHandlers,
} from '../../../__tests__/support/fake-login';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import {
  type BrowserLoginSession,
  type BrowserLoginState,
  loadFont,
  readFont,
  startBrowserLogin,
} from '../browser-login';

/** In-process loopback HTTP to the page: the server under test, no external network. */
function http(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: Record<string, unknown>; text: string; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }),
      );
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  http(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const state = async (session: BrowserLoginSession) =>
  (await http(`${session.url}state`)).json() as BrowserLoginState;

const until = (session: BrowserLoginSession, step: BrowserLoginState['step']) =>
  vi.waitFor(async () => expect((await state(session)).step).toBe(step));

describe('startBrowserLogin', () => {
  const sessions: BrowserLoginSession[] = [];
  const start = async (handlers: LoginHandlers = {}, options = {}) => {
    const fakes = identityUseCases(handlers);
    const session = await startBrowserLogin(fakes.useCases, { lingerMs: 1000, ...options });
    sessions.push(session);
    return { session, spies: fakes.spies };
  };
  afterEach(async () => {
    for (const s of sessions.splice(0)) {
      s.cancel();
      await s.result;
    }
  });

  it('serves the login page on 127.0.0.1 under a random token, with a strict CSP', async () => {
    const { session } = await start();
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/$/);
    const page = await http(session.url);

    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    const csp = String(page.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("style-src 'unsafe-inline';");
    expect(csp).toContain("font-src 'self';");
    expect(csp).not.toContain('http');
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('img-src');
    expect(page.text).toContain(`<script nonce="${nonce}">`);
  });

  it('runs the whole login in the page: email → code → QR code → logged in', async () => {
    const { session, spies } = await start();
    await until(session, 'email');

    expect((await post(`${session.url}email`, { email: ' me@example.com ' })).status).toBe(200);
    await until(session, 'code');
    expect(await state(session)).toEqual({ step: 'code', sent: 'Code sent to m***@example.com.' });
    expect(spies.login_start).toHaveBeenCalledWith({ email: 'me@example.com' });

    await post(`${session.url}code`, { code: '123456' });
    expect(await session.result).toEqual({
      ok: true,
      message: '✔ Logged in. Session valid until 2026-03-01T16:00:00.000Z.',
    });
    expect(spies.login_verify_code).toHaveBeenCalledWith({ code: '123456' });
    expect(await state(session)).toEqual({
      step: 'done',
      ok: true,
      message: expect.stringContaining('Logged in'),
    });
  });

  it('shows the approval QR code and progress while it waits for the phone', async () => {
    let approve: (value: unknown) => void = () => {};
    const responses = [{ authenticated: false, status: 'pending', message: 'Still waiting…' }];
    const { session } = await start({
      auth_status: () => ({ identified: true }),
      login_complete: () => responses.shift() ?? new Promise((resolve) => (approve = resolve)),
    });
    await until(session, 'approval');
    await vi.waitFor(async () =>
      expect((await state(session)) as { notes: string[] }).toMatchObject({ notes: ['Still waiting…'] }),
    );

    const shown = (await state(session)) as Extract<BrowserLoginState, { step: 'approval' }>;
    expect(shown).toMatchObject({ request: 'H7', message: APPROVAL.message, deepLink: APPROVAL.deepLink });
    expect(shown.qrSvg).toMatch(/^<svg/);
    approve(APPROVED);
    expect((await session.result).ok).toBe(true);
  });

  it('offers to try again after a failed attempt', async () => {
    const outcomes = [
      { authenticated: false, status: 'rejected', message: 'The login request was rejected.' },
    ];
    const { session, spies } = await start({
      auth_status: () => ({ identified: true }),
      login_complete: () => outcomes.shift() ?? APPROVED,
    });
    await until(session, 'done');
    expect(await state(session)).toEqual({
      step: 'done',
      ok: false,
      message: 'The login request was rejected.',
    });

    await post(`${session.url}retry`, {});
    expect((await session.result).ok).toBe(true);
    expect(spies.login_request_approval).toHaveBeenCalledTimes(2);
  });

  it('reports a crashing login as a failure and logs it', async () => {
    const logger = fakeLogger();
    const fakes = identityUseCases({});
    const session = await startBrowserLogin(
      fakes.useCases.filter((u) => u.name !== 'auth_status'),
      { lingerMs: 0, logger },
    );
    sessions.push(session);
    await until(session, 'done');
    expect(await state(session)).toEqual({
      step: 'done',
      ok: false,
      message: 'Login failed — Use case auth_status is not registered',
    });
    expect(logger.warn).toHaveBeenCalledWith('login: browser login failed', expect.anything());
  });

  it('ends at once when the user cancels, even while waiting for the approval', async () => {
    const { session } = await start({
      auth_status: () => ({ identified: true }),
      login_complete: () => new Promise(() => {}),
    });
    await until(session, 'approval');
    await post(`${session.url}cancel`, {});

    expect(await session.result).toEqual({ ok: false, message: 'Login cancelled.' });
    expect(await state(session)).toEqual({ step: 'done', ok: false, message: 'Login cancelled.' });
  });

  it('stops polling Thndr for the approval once cancelled', async () => {
    const { session, spies } = await start({
      auth_status: () => ({ identified: true }),
      login_complete: () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ authenticated: false, status: 'pending', message: 'Still waiting…' }),
            5,
          ),
        ),
    });
    await vi.waitFor(() => expect(spies.login_complete).toHaveBeenCalled());
    session.cancel();
    await session.settled;

    expect(spies.login_complete.mock.calls.length).toBeLessThan(5); // not the 30 waits of an uncancelled login
    expect(spies.login_complete).toHaveBeenCalledWith({ timeoutSeconds: 10 });
  });

  it('never shows the QR code after a cancel that landed during a step', async () => {
    let verified: (value: unknown) => void = () => {};
    const { session, spies } = await start({
      auth_status: () => ({ identified: true }),
      login_request_approval: () => new Promise((resolve) => (verified = resolve)),
    });
    await vi.waitFor(() => expect(spies.login_request_approval).toHaveBeenCalled());
    session.cancel();
    verified(APPROVAL);
    await session.settled;

    expect(await state(session)).toEqual({ step: 'done', ok: false, message: 'Login cancelled.' });
    expect(spies.login_complete).not.toHaveBeenCalled();
  });

  it('cancels a pending question and the retry offer', async () => {
    const first = await start();
    await until(first.session, 'email');
    first.session.cancel();
    expect(await first.session.result).toEqual({ ok: false, message: 'Login cancelled.' });
    expect(first.spies.login_start).not.toHaveBeenCalled();

    const second = await start({
      auth_status: () => ({ identified: true }),
      login_complete: () => ({ authenticated: false, status: 'expired', message: 'Expired.' }),
    });
    await until(second.session, 'done');
    second.session.cancel();
    second.session.cancel();
    expect((await second.session.result).message).toBe('Login cancelled.');
  });

  it('expires after its lifetime', async () => {
    const { session } = await start({}, { lifetimeMs: 50 });
    expect(await session.result).toEqual({ ok: false, message: 'Login cancelled.' });
  });

  it('closes the page after the login ended', async () => {
    const { session } = await start({ auth_status: () => ({ identified: true }) }, { lingerMs: 0 });
    await session.result;
    await vi.waitFor(() => expect(http(`${session.url}state`)).rejects.toThrow(), { timeout: 5_000 });
  });

  it('serves its own font', async () => {
    const { session } = await start();
    const res = await http(`${session.url}font.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
    expect(res.text.startsWith('wOF2')).toBe(true);
  });

  it('answers 404 for the font when it is not installed', async () => {
    const { session } = await start({}, { font: async () => null });
    expect((await http(`${session.url}font.woff2`)).status).toBe(404);
  });

  it('reads the font through the given resolver and copes with a missing package', async () => {
    const missing = () => {
      throw new Error('Cannot find module');
    };
    expect(await readFont(missing)).toBeNull();
    expect((await loadFont())?.subarray(0, 4).toString()).toBe('wOF2');
  });

  describe('rejects requests that do not come from its own page', () => {
    it('with another Host header (DNS rebinding)', async () => {
      const { session } = await start();
      expect((await http(`${session.url}state`, { headers: { host: 'evil.example:80' } })).status).toBe(403);
      const port = new URL(session.url).port;
      expect((await http(`${session.url}state`, { headers: { host: `localhost:${port}` } })).status).toBe(
        200,
      );
    });

    it('without the token, or on unknown routes', async () => {
      const { session } = await start();
      const origin = new URL(session.url).origin;
      expect((await http(`${origin}/state`)).status).toBe(404);
      expect((await http(`${session.url}nope`)).status).toBe(404);
      expect((await post(`${session.url}nope`, {})).status).toBe(404);
      expect((await http(`${session.url}email`, { method: 'PUT' })).status).toBe(404);
    });

    it('from another origin, or not as JSON', async () => {
      const { session } = await start();
      await until(session, 'email');
      expect(
        (await post(`${session.url}email`, { email: 'a@b.c' }, { origin: 'https://evil.example' })).status,
      ).toBe(403);
      const form = await http(`${session.url}email`, {
        method: 'POST',
        body: 'email=a@b.c',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(form.status).toBe(415);
      const port = new URL(session.url).port;
      expect((await post(`${session.url}cancel`, {}, { origin: `http://localhost:${port}` })).status).toBe(
        200,
      );
    });
  });

  it('validates what the page posts', async () => {
    const { session } = await start();
    await until(session, 'email');
    const raw = (body: string) =>
      http(`${session.url}email`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });

    expect((await raw('{oops')).status).toBe(400);
    expect((await raw('[1]')).status).toBe(400);
    expect((await raw('')).status).toBe(400);
    expect((await raw(JSON.stringify({ email: 'x'.repeat(4096) }))).status).toBe(413);
    expect((await post(`${session.url}email`, { email: '  ' })).json()).toEqual({ error: 'Missing email' });
    expect((await post(`${session.url}code`, { code: '1' })).status).toBe(409);
    expect((await post(`${session.url}retry`, {})).status).toBe(409);
  });
});
