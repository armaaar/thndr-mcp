import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { compose } from '../container';
import type { RecordedRequest } from './support/fake-fetch';
import { fakeFetch, json } from './support/fake-fetch';
import { type ConnectedClient, connect } from './support/mcp-client';

const NOW = new Date('2026-03-01T10:00:00Z');
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Minimal in-memory Firebase identity double. */
function fakeIdentity() {
  let token: string | null = null;
  return () => ({
    signInWithCustomToken: async (custom: string) => {
      token = `id-for-${custom}`;
    },
    getIdToken: async () => token,
    signOut: async () => {
      token = null;
    },
  });
}

function route(req: RecordedRequest): Response {
  const url = new URL(req.url);
  const key = `${req.method} ${url.host}${url.pathname}`;
  switch (key) {
    case 'POST prod.test/auth-service/v2/users/email-code':
      return json({ id: 'vid-1' });
    case 'POST prod.test/auth-service/v2/users/login':
      return json({ firebase_auth_token: 'custom-1' });
    case 'POST prod.test/auth-service/tokens/request':
      return json({ id: 'req-1', request_secret: 'sec-1', human_id: 'H7', status: 'pending' });
    case 'POST prod.test/auth-service/tokens/request/req-1/status':
      return json({ status: 'approved' });
    case 'POST web.test/api/auth/login':
      return new Response(
        JSON.stringify({
          auth_token: 'access-1',
          auth_token_expires_at: '2026-03-01T10:15:00Z',
          refresh_token_expires_at: '2026-03-01T16:00:00Z',
        }),
        { status: 200, headers: [['set-cookie', 'rt=refresh-1; Path=/; HttpOnly']] },
      );
    case 'GET prod.test/market-service/accounts/wallet-and-portfolio':
      return json({
        purchase_power: 1000,
        cash_in_holding: 50,
        unsettled_cash: 100,
        portfolio: { portfolio_value: 5000, total_return: 250, total_return_prc: 5, positions: [] },
      });
    default:
      return json({ detail: { msg: `unexpected ${key}`, type: 'TEST' } }, 404);
  }
}

describe('composition root (end to end, fake network)', () => {
  let dir: string;
  let conn: ConnectedClient | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thndr-mcp-e2e-'));
  });
  afterEach(async () => {
    await conn?.close();
    conn = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  function build() {
    const fetch = fakeFetch(route);
    const config = {
      ...loadConfig({}),
      apiBaseUrl: 'https://prod.test',
      webBaseUrl: 'https://web.test/api',
      sessionFile: join(dir, 'session.json'),
    };
    const app = compose(config, {
      fetch,
      clock: { now: () => NOW },
      logger: silent,
      identity: fakeIdentity(),
    });
    return { app, fetch, config };
  }

  it('wires every read-only tool and no order-entry tool', () => {
    const { app } = build();
    const names = app.useCases.map((t) => t.name);
    expect(names).toContain('login_start');
    expect(names).toContain('get_price_history');
    expect(names).toContain('get_account_summary');
    expect(names.some((n) => /place|cancel|modify|order_instruction/.test(n))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('logs in through the MCP tools, persists the session and calls an authenticated endpoint', async () => {
    const { app, fetch, config } = build();
    conn = await connect(app.useCases, silent);

    expect((await conn.call('get_account_summary')).json).toMatchObject({ error: 'NOT_AUTHENTICATED' });

    expect((await conn.call('login_start', { email: 'Me@Example.com' })).json).toMatchObject({
      maskedEmail: 'm***@example.com',
    });
    const approval = (await conn.call('login_verify_code', { code: '123456' })).json as { deepLink: string };
    expect(approval.deepLink).toContain('requestId=req-1');
    expect((await conn.call('login_complete', { timeoutSeconds: 0 })).json).toMatchObject({
      authenticated: true,
    });

    const session = JSON.parse(await readFile(config.sessionFile, 'utf8'));
    expect(session.thndr.cookies).toEqual({ rt: 'refresh-1' });
    expect((await stat(config.sessionFile)).mode & 0o777).toBe(0o600);

    const summary = (await conn.call('get_account_summary')).json as Record<string, unknown>;
    expect(summary).toMatchObject({ market: 'egypt' });
    const call = fetch.calls.find((c) => c.url.includes('wallet-and-portfolio'));
    expect(call?.headers.authorization).toBe('Bearer access-1');
    expect(call?.headers['x-thndrx-runtime-version']).toBe(config.runtimeVersion);
    expect(call?.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);

    expect((await conn.call('auth_status')).json).toMatchObject({ authenticated: true, identified: true });
  });

  it('builds with the real Firebase provider and default logger', () => {
    const app = compose({ ...loadConfig({}), sessionFile: join(dir, 's.json'), logLevel: 'silent' });
    expect(app.useCases.length).toBeGreaterThan(20);
  });
});
