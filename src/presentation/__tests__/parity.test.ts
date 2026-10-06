import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, json, type RecordedRequest } from '../../__tests__/support/fake-fetch';
import { type ConnectedClient, connect } from '../../__tests__/support/mcp-client';
import type { UseCase } from '../../application/use-case';
import { loadConfig } from '../../config';
import { compose } from '../../container';
import { runCli } from '../cli/cli';
import { commandName } from '../cli/positionals';

/**
 * ADR 0012 — the key guarantee: MCP and CLI are two delivery mechanisms over one list of use cases. For the same
 * input they produce the same result: the CLI `--json` output is exactly the MCP tool's JSON, for successes and
 * for failures alike.
 */

const NOW = new Date('2026-03-01T10:00:00Z');
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const COMI = '11111111-1111-4111-8111-111111111111';
const HRHO = '22222222-2222-4222-8222-222222222222';

/** One Firebase identity shared by every app instance (it lives in the same session file in reality). */
function sharedIdentity() {
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
    case 'GET prod.test/assets-service/assets/search': {
      const query = (url.searchParams.get('query') ?? '').toUpperCase();
      const assets = [
        {
          id: COMI,
          symbol: 'COMI',
          name: 'Commercial International Bank',
          asset_class: 'STOCK',
          currency: 1,
        },
        { id: HRHO, symbol: 'HRHO', name: 'EFG Holding', asset_class: 'STOCK', currency: 1 },
      ].filter((a) => a.symbol.startsWith(query));
      return json({ assets });
    }
    case 'GET prod.test/assets-service/assets/marketwatch':
      return json({
        assets: [
          {
            asset_id: COMI,
            reuters: 'COMI',
            eng_name: 'Commercial International Bank',
            eng_desc: 'Banks',
            currency: 1,
            last_trade_price: 80.5,
            listed_shares: 1000,
          },
          {
            asset_id: HRHO,
            reuters: 'HRHO',
            eng_name: 'EFG Holding',
            eng_desc: 'Financial Services',
            currency: 1,
            last_trade_price: 21.25,
            listed_shares: 500,
          },
        ],
      });
    case 'GET prod.test/market-service/accounts/wallet-and-portfolio':
      return json({
        purchase_power: 1000,
        cash_in_holding: 50,
        unsettled_cash: 100,
        portfolio: { portfolio_value: 5000, total_return: 250, total_return_prc: 5, positions: [] },
      });
    case 'GET prod.test/users-service/watchlists':
      return json({
        watchlists: [
          { id: 'w1', name: 'Banks', color: 'color_4', icon: 'thndr', count: 2, asset_ids: [COMI, HRHO] },
        ],
      });
    case 'GET prod.test/users-service/watchlists/missing':
      return json({ detail: { msg: 'Watchlist not found', type: 'NOT_FOUND' } }, 404);
    case 'GET prod.test/market-service/v3/orders':
      return json({
        data: [
          {
            id: 123,
            asset_id: COMI,
            stock_id: 'COMI',
            order_type: 'buy',
            is_limit: true,
            amount: 100,
            amount_filled: 40,
            price: 79.5,
            limit_price: 80,
            order_status: 'PENDING',
            created_at: '2026-02-28T10:00:00Z',
            updated_at: '2026-02-28T11:00:00Z',
          },
        ],
        has_next: false,
      });
    default:
      return json({ detail: { msg: `unexpected ${key}`, type: 'TEST' } }, 404);
  }
}

type Case = { tool: string; args: Record<string, unknown>; argv: string[] };

describe('MCP ↔ CLI parity (same use cases, same results)', () => {
  let dir: string;
  let conn: ConnectedClient | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thndr-parity-'));
  });
  afterEach(async () => {
    await conn?.close();
    conn = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  /** Two independent app instances (an MCP server process and a CLI process) over one session file. */
  function build() {
    const config = {
      ...loadConfig({}),
      apiBaseUrl: 'https://prod.test',
      webBaseUrl: 'https://web.test/api',
      sessionFile: join(dir, 'session.json'),
    };
    const identity = sharedIdentity();
    const make = () =>
      compose(config, { fetch: fakeFetch(route), clock: { now: () => NOW }, logger: silent, identity });
    return { mcpApp: make(), cliApp: make() };
  }

  /** Logs in through the identity use cases (persists the session file both apps read). */
  async function login(useCases: readonly UseCase[]) {
    const find = (name: string) => useCases.find((u) => u.name === name) as UseCase;
    await find('login_start').run({ email: 'me@example.com' });
    await find('login_verify_code').run({ code: '123456' });
    expect(await find('login_complete').run({ timeoutSeconds: 0 })).toMatchObject({ authenticated: true });
  }

  async function cli(useCases: readonly UseCase[], argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli([...argv, '--json'], {
      useCases,
      version: '0.0.0-test',
      logger: silent,
      io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    });
    return { code, out, err };
  }

  async function loggedIn() {
    const { mcpApp, cliApp } = build();
    await login(mcpApp.useCases);
    conn = await connect(mcpApp.useCases, silent);
    return { mcpApp, cliApp, conn };
  }

  const successCases: Case[] = [
    { tool: 'auth_status', args: {}, argv: ['auth-status'] },
    {
      tool: 'get_price_snapshot',
      args: { symbols: ['COMI', 'HRHO'] },
      argv: ['get-price-snapshot', 'COMI', 'HRHO'],
    },
    {
      tool: 'get_price_snapshot',
      args: { symbols: ['comi'], market: 'egypt' },
      argv: ['get-price-snapshot', '--symbols', 'comi', '--market', 'egypt'],
    },
    { tool: 'get_account_summary', args: {}, argv: ['get-account-summary'] },
    { tool: 'get_watchlists', args: {}, argv: ['get-watchlists'] },
    { tool: 'get_account_orders', args: { limit: 5 }, argv: ['get-account-orders', '--limit', '5'] },
  ];

  it('returns identical JSON for the same use case in every bounded context', async () => {
    const { cliApp, conn } = await loggedIn();
    for (const c of successCases) {
      const mcp = await conn.call(c.tool, c.args);
      const viaCli = await cli(cliApp.useCases, c.argv);
      expect(mcp.isError, `${c.tool} MCP error: ${JSON.stringify(mcp.json)}`).toBeFalsy();
      expect(viaCli.code, `${c.tool} CLI: ${viaCli.err.join('\n')}`).toBe(0);
      expect(viaCli.err).toEqual([]);
      expect(JSON.parse(viaCli.out[0] as string), c.tool).toEqual(mcp.json);
      expect(viaCli.out[0]).toBe((mcp.content as Array<{ text: string }>)[0]?.text);
    }
  });

  it('really ran authenticated use cases against the (fake) broker', async () => {
    const { cliApp, conn } = await loggedIn();
    expect((await conn.call('get_account_summary')).json).toMatchObject({
      market: 'egypt',
      buyingPower: 1000,
      portfolioValue: 5000,
    });
    const snapshot = JSON.parse(
      (await cli(cliApp.useCases, ['get-price-snapshot', 'COMI', 'HRHO'])).out[0] as string,
    );
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.quotes.map((q: { ticker: string; last: number }) => [q.ticker, q.last])).toEqual([
      ['COMI', 80.5],
      ['HRHO', 21.25],
    ]);
    const watchlists = (await conn.call('get_watchlists')).json as {
      watchlists: Array<{ instruments: unknown[] }>;
    };
    expect(watchlists.watchlists[0]?.instruments).toEqual([
      { instrumentId: COMI, ticker: 'COMI' },
      { instrumentId: HRHO, ticker: 'HRHO' },
    ]);
    const orders = JSON.parse((await cli(cliApp.useCases, ['get-account-orders'])).out[0] as string);
    expect(orders.orders[0]).toMatchObject({
      id: '123',
      ticker: 'COMI',
      side: 'BUY',
      quantity: 100,
      isOpen: true,
    });
    expect(JSON.parse((await cli(cliApp.useCases, ['auth-status'])).out[0] as string)).toMatchObject({
      authenticated: true,
      identified: true,
    });
  });

  it('returns identical failures (not authenticated, not found, upstream error)', async () => {
    const { mcpApp, cliApp } = build();
    conn = await connect(mcpApp.useCases, silent);

    const unauthenticated = await conn.call('get_account_summary', {});
    const unauthenticatedCli = await cli(cliApp.useCases, ['get-account-summary']);
    expect(unauthenticated.isError).toBe(true);
    expect(unauthenticated.json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(unauthenticatedCli.code).toBe(1);
    expect(JSON.parse(unauthenticatedCli.err[0] as string)).toEqual(unauthenticated.json);

    await login(mcpApp.useCases);

    const failures: Array<Case & { error: string }> = [
      {
        tool: 'get_price_snapshot',
        args: { symbols: ['ZZZZ'] },
        argv: ['get-price-snapshot', 'ZZZZ'],
        error: 'NOT_FOUND',
      },
      {
        tool: 'get_watchlist',
        args: { id: 'missing' },
        argv: ['get-watchlist', 'missing'],
        error: 'UPSTREAM_ERROR',
      },
    ];
    for (const c of failures) {
      const mcp = await conn.call(c.tool, c.args);
      const viaCli = await cli(cliApp.useCases, c.argv);
      expect(mcp.isError, c.tool).toBe(true);
      expect(mcp.json, c.tool).toMatchObject({ error: c.error });
      expect(viaCli.code, c.tool).toBe(1);
      expect(viaCli.out).toEqual([]);
      expect(JSON.parse(viaCli.err[0] as string), c.tool).toEqual(mcp.json);
      expect(viaCli.err[0]).toBe((mcp.content as Array<{ text: string }>)[0]?.text);
    }
  });

  it('returns the same INVALID_INPUT error view in both interfaces', async () => {
    const { cliApp, conn } = await loggedIn();
    const invalid: Case[] = [
      { tool: 'get_account_orders', args: { limit: 0 }, argv: ['get-account-orders', '--limit', '0'] },
      {
        tool: 'get_price_snapshot',
        args: { symbols: ['COMI'], market: 'mars' },
        argv: ['get-price-snapshot', 'COMI', '--market', 'mars'],
      },
      {
        tool: 'get_price_history',
        args: { symbol: 'COMI', from: 'soon' },
        argv: ['get-price-history', 'COMI', '--from', 'soon'],
      },
    ];
    for (const c of invalid) {
      const mcp = await conn.call(c.tool, c.args);
      const viaCli = await cli(cliApp.useCases, c.argv);
      expect(mcp.isError, c.tool).toBe(true);
      expect(mcp.json, c.tool).toMatchObject({ error: 'INVALID_INPUT' });
      expect(viaCli.code, c.tool).toBe(2);
      expect(JSON.parse(viaCli.err[0] as string), c.tool).toEqual(mcp.json);
    }
    expect((await conn.call('get_account_orders', { limit: 0 })).json).toMatchObject({
      message: expect.stringMatching(/^limit: /),
    });
  });

  it('rejects unknown fields over MCP just as the CLI rejects unknown flags', async () => {
    const { cliApp, conn } = await loggedIn();
    const mcp = await conn.call('get_account_summary', { verbose: true });
    expect(mcp.isError).toBe(true);
    expect(mcp.json).toMatchObject({ error: 'INVALID_INPUT' });
    expect((await cli(cliApp.useCases, ['get-account-summary', '--verbose'])).code).toBe(2);
  });

  it('exposes exactly the same use cases through both interfaces', async () => {
    const { mcpApp } = build();
    conn = await connect(mcpApp.useCases, silent);
    const { tools } = await conn.client.listTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(mcpApp.useCases.map((u) => u.name));

    const out: string[] = [];
    expect(
      await runCli([], {
        useCases: mcpApp.useCases,
        version: '0',
        io: { out: (t) => out.push(t), err() {} },
      }),
    ).toBe(0);
    const listed = (out[0] as string)
      .split('\n')
      .map((line) => /^ {2}(\S+) {2,}/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined && name !== 'login');
    expect([...listed].sort()).toEqual(toolNames.map((n) => n.replaceAll('_', '-')).sort());
    expect(listed).toHaveLength(new Set(listed).size);

    for (const useCase of mcpApp.useCases) {
      const tool = tools.find((t) => t.name === useCase.name);
      expect(tool?.description).toBe(useCase.description);
      const help: string[] = [];
      expect(
        await runCli(['help', commandName(useCase)], {
          useCases: mcpApp.useCases,
          version: '0',
          io: { out: (t) => help.push(t), err() {} },
        }),
      ).toBe(0);
      expect(help[0]).toContain(`MCP tool: ${useCase.name}.`);
      expect(help[0]).toContain(useCase.description);
    }
  });
});
