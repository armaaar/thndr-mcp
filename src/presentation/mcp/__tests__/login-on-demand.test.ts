import {
  ElicitationCompleteNotificationSchema,
  type ElicitRequest,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityUseCases } from '../../../__tests__/support/fake-login';
import { FakeQuery } from '../../../__tests__/support/fake-use-cases';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import { type ConnectedClient, connect, type ElicitHandler } from '../../../__tests__/support/mcp-client';
import { NotAuthenticatedError, SessionExpiredError } from '../../../application/errors';
import type { UseCase } from '../../../application/use-case';
import type { BrowserLoginSession } from '../../browser/browser-login';
import type { GuidedLoginResult } from '../../presenters/guided-login';

type Params = ElicitRequest['params'];
const URL_ = 'http://127.0.0.1:4242/token/';
const LOGGED_IN: GuidedLoginResult = { ok: true, message: '✔ Logged in.' };
const CANCELLED: GuidedLoginResult = { ok: false, message: 'Login cancelled.' };

/** A browser login whose outcome the test decides. */
function browser() {
  let finish: (result: GuidedLoginResult) => void = () => {};
  const result = new Promise<GuidedLoginResult>((resolve) => {
    finish = resolve;
  });
  const session: BrowserLoginSession = {
    url: URL_,
    result,
    settled: result.then(() => undefined),
    cancel: vi.fn(() => finish(CANCELLED)),
  };
  const start = vi.fn(async (_useCases: readonly UseCase[]) => session);
  const open = vi.fn();
  return { session, start, open, finish: (r: GuidedLoginResult) => finish(r) };
}

/** A portfolio tool that needs a session; `state.loggedIn` flips when the test finishes the login. */
function portfolioTool(error: () => Error = () => new NotAuthenticatedError()) {
  const state = { loggedIn: false };
  const handler = vi.fn(() => {
    if (!state.loggedIn) throw error();
    return { positions: [{ ticker: 'COMI' }] };
  });
  return {
    state,
    handler,
    tool: new FakeQuery({ name: 'get_account_positions', context: 'portfolio', handler }),
  };
}

describe('MCP login on demand (ADR 0016, ADR 0017)', () => {
  let connected: ConnectedClient | undefined;
  afterEach(async () => {
    await connected?.close();
    connected = undefined;
  });

  const setup = async (
    options: {
      elicit?: ElicitHandler;
      url?: boolean;
      error?: () => Error;
      logger?: ReturnType<typeof fakeLogger>;
    } = {},
  ) => {
    const b = browser();
    const p = portfolioTool(options.error);
    const { useCases: login } = identityUseCases({});
    const logger = options.logger ?? fakeLogger();
    connected = await connect([...login, p.tool], logger, {
      ...(options.elicit ? { elicit: options.elicit } : {}),
      ...(options.url ? { url: true } : {}),
      login: { start: b.start, open: b.open, logger },
    });
    /** Logs the user in "in the browser". */
    const logIn = () => {
      p.state.loggedIn = true;
      b.finish(LOGGED_IN);
    };
    return { ...b, ...p, logIn, client: connected, logger };
  };

  it('opens the browser login and answers the call once the user logged in (client without elicitation)', async () => {
    const t = await setup();
    const progress: Array<string | undefined> = [];
    const call = t.client.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
      onprogress: (p) => progress.push(p.message),
    });
    await vi.waitFor(() => expect(t.open).toHaveBeenCalledWith(URL_));
    t.logIn();
    const result = await call;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ positions: [{ ticker: 'COMI' }] });
    expect(t.start).toHaveBeenCalledOnce();
    expect(t.handler).toHaveBeenCalledTimes(2);
    expect(progress[0]).toBe(`Log in to Thndr in your browser: ${URL_}`);
    expect(t.logger.debug).toHaveBeenCalledWith(`login: Log in to Thndr in your browser: ${URL_}`);
    expect(t.logger.info).not.toHaveBeenCalledWith(expect.stringContaining(URL_));
  });

  it('keeps reporting progress while it waits', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const t = await setup();
      const progress: Array<string | undefined> = [];
      const call = t.client.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
        onprogress: (p) => progress.push(p.message),
      });
      await vi.waitFor(() => expect(progress).toHaveLength(1));
      vi.advanceTimersByTime(15_000);
      await vi.waitFor(() => expect(progress).toHaveLength(2));
      t.logIn();
      await call;
    } finally {
      vi.useRealTimers();
    }
  });

  it('on SESSION_EXPIRED does the same', async () => {
    const t = await setup({ error: () => new SessionExpiredError() });
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    t.logIn();
    expect((await call).isError).toBeFalsy();
  });

  it('with form elicitation, shows a short prompt with the link that closes once logged in', async () => {
    const asked: Params[] = [];
    const t = await setup({
      elicit: (params) => {
        asked.push(params);
        return new Promise<ElicitResult>(() => {}); // the user leaves the prompt open
      },
    });
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(t.open).toHaveBeenCalledWith(URL_);
    expect(asked[0]).toMatchObject({ mode: 'form', requestedSchema: { type: 'object', properties: {} } });
    expect(asked[0]?.message.split('\n')[0]).toBe(
      'Log in to Thndr in the browser tab that just opened. This closes once you are logged in.',
    );
    expect(asked[0]?.message).toContain(`Not opened? ${URL_}`);

    t.logIn();
    expect((await call).isError).toBeFalsy();
  });

  it('keeps waiting when the user accepts the prompt before logging in', async () => {
    const t = await setup({ elicit: async () => ({ action: 'accept' }) });
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.session.cancel).not.toHaveBeenCalled();
    t.logIn();
    expect((await call).isError).toBeFalsy();
  });

  it.each(['decline', 'cancel'] as const)('cancels the login when the user chooses %s', async (action) => {
    const t = await setup({ elicit: async () => ({ action }) });
    const result = await t.client.call('get_account_positions');

    expect(t.session.cancel).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED', login: 'Login cancelled.' });
    expect(t.handler).toHaveBeenCalledOnce();
  });

  it('with URL elicitation, lets the client open the page and tells it when the login completed', async () => {
    const asked: Params[] = [];
    const t = await setup({
      url: true,
      elicit: async (params) => {
        asked.push(params);
        return { action: 'accept' };
      },
    });
    const completed: string[] = [];
    t.client.client.setNotificationHandler(ElicitationCompleteNotificationSchema, (n) => {
      completed.push(n.params.elicitationId);
    });
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatchObject({ mode: 'url', url: URL_, message: 'Log in to Thndr in your browser.' });
    expect(t.open).not.toHaveBeenCalled();

    t.logIn();
    expect((await call).isError).toBeFalsy();
    const id = (asked[0] as { elicitationId: string }).elicitationId;
    await vi.waitFor(() => expect(completed).toEqual([id]));
  });

  it('with URL elicitation, a declined link cancels the login', async () => {
    const t = await setup({ url: true, elicit: async () => ({ action: 'decline' }) });
    const result = await t.client.call('get_account_positions');
    expect(t.session.cancel).toHaveBeenCalled();
    expect(result.json).toMatchObject({ login: 'Login cancelled.' });
  });

  it('keeps waiting for the browser when the prompt itself fails', async () => {
    const logger = fakeLogger();
    const t = await setup({
      logger,
      elicit: () => {
        throw new Error('client crashed');
      },
    });
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() =>
      expect(logger.debug).toHaveBeenCalledWith('login: login prompt ended', expect.anything()),
    );
    t.logIn();
    expect((await call).isError).toBeFalsy();
  });

  it('runs one login for concurrent calls', async () => {
    const t = await setup();
    const calls = [t.client.call('get_account_positions'), t.client.call('get_account_positions')];
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    t.logIn();
    const results = await Promise.all(calls);

    expect(results.every((r) => !r.isError)).toBe(true);
    expect(t.start).toHaveBeenCalledOnce();
    expect(t.open).toHaveBeenCalledOnce();
  });

  it('starts a fresh login after a finished one', async () => {
    const t = await setup();
    t.session.cancel();
    await t.client.call('get_account_positions');
    await t.client.call('get_account_positions');
    expect(t.start).toHaveBeenCalledTimes(2);
  });

  it('returns the original error with the login outcome when the login fails', async () => {
    const t = await setup();
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    t.finish({ ok: false, message: 'Gave up waiting for approval.' });
    const result = await call;

    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED', login: 'Gave up waiting for approval.' });
    expect(t.handler).toHaveBeenCalledOnce();
  });

  it('retries the tool only once, even if it still has no session after the login', async () => {
    const t = await setup();
    const call = t.client.call('get_account_positions');
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    t.finish(LOGGED_IN); // but the tool still has no session
    const result = await call;

    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(result.json).not.toHaveProperty('login');
    expect(t.handler).toHaveBeenCalledTimes(2);
  });

  it('reports a browser login that could not start', async () => {
    const logger = fakeLogger();
    const t = await setup({ logger });
    t.start.mockRejectedValueOnce(new Error('EADDRINUSE'));
    const result = await t.client.call('get_account_positions');
    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED', login: 'Login failed — EADDRINUSE' });
    expect(logger.warn).toHaveBeenCalledWith('login: browser login failed', expect.anything());
    expect(t.open).not.toHaveBeenCalled();
  });

  it('reports a browser login whose result rejects as a failed login', async () => {
    const logger = fakeLogger();
    const t = await setup({ logger });
    t.start.mockResolvedValueOnce({
      url: URL_,
      result: Promise.reject('broken'),
      settled: Promise.resolve(),
      cancel: vi.fn(),
    });
    const result = await t.client.call('get_account_positions');
    expect(result.json).toMatchObject({ login: 'Login failed — broken' });
    expect(logger.warn).toHaveBeenCalledWith('login: browser login failed', expect.anything());

    t.start.mockResolvedValueOnce({
      url: URL_,
      result: Promise.reject(new Error('gone')),
      settled: Promise.resolve(),
      cancel: vi.fn(),
    });
    expect((await t.client.call('get_account_positions')).json).toMatchObject({
      login: 'Login failed — gone',
    });
  });

  it('leaves the browser login running when the client cancels the call', async () => {
    const t = await setup({ elicit: () => new Promise<ElicitResult>(() => {}) });
    const controller = new AbortController();
    const call = t.client.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled());
    controller.abort();
    await expect(call).rejects.toThrow();
    expect(t.session.cancel).not.toHaveBeenCalled();

    t.logIn();
    expect((await t.client.call('get_account_positions')).isError).toBeFalsy();
  });

  it('prompts only from the call that started the login', async () => {
    const asked: Params[] = [];
    const t = await setup({
      elicit: (params) => {
        asked.push(params);
        return new Promise<ElicitResult>(() => {});
      },
    });
    const calls = [t.client.call('get_account_positions'), t.client.call('get_account_positions')];
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked).toHaveLength(1);
    t.logIn();
    expect((await Promise.all(calls)).every((r) => !r.isError)).toBe(true);
  });

  it('starts a new login only after the previous one stopped in the background', async () => {
    const t = await setup();
    let stopped: () => void = () => {};
    const first = {
      url: URL_,
      result: Promise.resolve(CANCELLED),
      settled: new Promise<void>((resolve) => {
        stopped = resolve;
      }),
      cancel: vi.fn(),
    };
    t.start.mockResolvedValueOnce(first);
    expect((await t.client.call('get_account_positions')).json).toMatchObject({ login: 'Login cancelled.' });

    const second = t.client.call('get_account_positions');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.start).toHaveBeenCalledTimes(1); // still waiting for the first login to stop
    stopped();
    await vi.waitFor(() => expect(t.start).toHaveBeenCalledTimes(2));
    t.logIn();
    expect((await second).isError).toBeFalsy();
  });

  it('stops reporting progress once the client cancelled the call', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const t = await setup();
      const progress: Array<string | undefined> = [];
      const controller = new AbortController();
      const call = t.client.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
        signal: controller.signal,
        onprogress: (p) => progress.push(p.message),
      });
      await vi.waitFor(() => expect(progress).toHaveLength(1));
      controller.abort();
      await expect(call).rejects.toThrow();
      vi.advanceTimersByTime(60_000);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(progress).toHaveLength(1);
      t.logIn();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never starts a login from the identity tools themselves', async () => {
    const t = await setup();
    const { useCases } = identityUseCases({
      login_complete: () => {
        throw new NotAuthenticatedError('Firebase identity lost.');
      },
    });
    await t.client.close();
    connected = await connect(useCases, undefined, { login: { start: t.start, open: t.open } });
    expect((await connected.call('login_complete')).json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(t.start).not.toHaveBeenCalled();
  });

  it('does not log in for other errors', async () => {
    const t = await setup({ error: () => new Error('boom') });
    expect((await t.client.call('get_account_positions')).json).toMatchObject({ error: 'INTERNAL_ERROR' });
    expect(t.start).not.toHaveBeenCalled();
  });

  it('is off unless the server is given a login', async () => {
    const p = portfolioTool();
    connected = await connect([p.tool]);
    const result = await connected.call('get_account_positions');
    expect(result.json).toEqual({ error: 'NOT_AUTHENTICATED', message: new NotAuthenticatedError().message });
  });
});
