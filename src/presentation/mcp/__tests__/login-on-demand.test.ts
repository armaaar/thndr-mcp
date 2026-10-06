import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL,
  APPROVED,
  identityUseCases,
  type LoginHandlers,
} from '../../../__tests__/support/fake-login';
import { FakeQuery } from '../../../__tests__/support/fake-use-cases';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import { type ConnectedClient, connect, type ElicitHandler } from '../../../__tests__/support/mcp-client';
import { NotAuthenticatedError, SessionExpiredError } from '../../../application/errors';
import { elicitationDialog, LoginOnDemand } from '../login-on-demand';

type Params = ElicitRequest['params'];
const fieldOf = (params: Params) =>
  'requestedSchema' in params ? Object.keys(params.requestedSchema.properties)[0] : undefined;

/** A user who answers each question: email, code, then "I approved it". */
function user(
  answers: { email?: string; code?: string } = {},
  override?: (params: Params) => ElicitResult | null,
) {
  const asked: Params[] = [];
  const elicit = vi.fn(async (params: Params): Promise<ElicitResult> => {
    asked.push(params);
    const custom = override?.(params);
    if (custom) return custom;
    const field = fieldOf(params);
    if (field === 'email') return { action: 'accept', content: { email: answers.email ?? 'me@example.com' } };
    if (field === 'code') return { action: 'accept', content: { code: answers.code ?? '123456' } };
    return { action: 'accept' };
  });
  return { asked, elicit };
}

/** A portfolio tool that needs a session, and the login use cases that establish one. */
function app(handlers: LoginHandlers = {}, error: () => Error = () => new NotAuthenticatedError()) {
  let loggedIn = false;
  const { useCases: login, spies } = identityUseCases({
    login_complete: () => {
      loggedIn = true;
      return APPROVED;
    },
    ...handlers,
  });
  const positions = vi.fn(() => {
    if (!loggedIn) throw error();
    return { positions: [{ ticker: 'COMI' }] };
  });
  const useCases = [
    ...login,
    new FakeQuery({ name: 'get_account_positions', context: 'portfolio', handler: positions }),
  ];
  return { useCases, spies, positions };
}

describe('MCP login on demand (ADR 0016)', () => {
  let connected: ConnectedClient | undefined;
  afterEach(async () => {
    await connected?.close();
    connected = undefined;
  });

  const open = async (
    useCases: Parameters<typeof connect>[0],
    elicit?: ElicitHandler,
    logger = fakeLogger(),
  ) => {
    connected = await connect(useCases, logger, elicit ? { elicit } : {});
    return connected;
  };

  it('asks the user to log in through elicitation, then answers the original call', async () => {
    const { useCases, spies, positions } = app();
    const u = user();
    const result = await (await open(useCases, u.elicit)).call('get_account_positions');

    expect(result.isError).toBeFalsy();
    expect(result.json).toEqual({ positions: [{ ticker: 'COMI' }] });
    expect(positions).toHaveBeenCalledTimes(2);
    expect(spies.login_start).toHaveBeenCalledWith({ email: 'me@example.com' });
    expect(spies.login_verify_code).toHaveBeenCalledWith({ code: '123456' });
    expect(spies.login_complete).toHaveBeenCalledWith({ timeoutSeconds: 60 });

    expect(u.asked.map(fieldOf)).toEqual(['email', 'code', undefined]);
    expect(u.asked[0]).toMatchObject({
      mode: 'form',
      requestedSchema: {
        type: 'object',
        properties: { email: { type: 'string', format: 'email', title: 'Thndr account email' } },
        required: ['email'],
      },
    });
    expect(u.asked[1]?.message).toBe('Code sent to m***@example.com. Enter the 6-digit code.');
    expect(u.asked[2]?.message).toContain(APPROVAL.message);
    expect(u.asked[2]?.message).toContain(APPROVAL.deepLink);
  });

  it('on SESSION_EXPIRED only asks for a new phone approval', async () => {
    const { useCases, spies } = app(
      { auth_status: () => ({ identified: true }) },
      () => new SessionExpiredError(),
    );
    const u = user();
    const result = await (await open(useCases, u.elicit)).call('get_account_positions');

    expect(result.isError).toBeFalsy();
    expect(u.asked).toHaveLength(1);
    expect(spies.login_request_approval).toHaveBeenCalledOnce();
    expect(spies.login_start).not.toHaveBeenCalled();
  });

  it('returns the original error with the login outcome when the user declines', async () => {
    const { useCases, spies } = app();
    const u = user({}, () => ({ action: 'decline' }));
    const result = await (await open(useCases, u.elicit)).call('get_account_positions');

    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED', login: 'Login cancelled.' });
    expect(spies.login_start).not.toHaveBeenCalled();
  });

  it('treats a cancelled approval question as a cancelled login', async () => {
    const { useCases, spies } = app();
    const u = user({}, (params) => (fieldOf(params) === undefined ? { action: 'cancel' } : null));
    const result = await (await open(useCases, u.elicit)).call('get_account_positions');

    expect(result.json).toMatchObject({ login: 'Login cancelled.' });
    expect(spies.login_complete).not.toHaveBeenCalled();
  });

  it('reports a failing login step and does not retry the tool', async () => {
    const { useCases, positions } = app({
      login_complete: () => ({
        authenticated: false,
        status: 'rejected',
        message: 'The login request was rejected.',
      }),
    });
    const result = await (await open(useCases, user().elicit)).call('get_account_positions');

    expect(result.json).toMatchObject({
      error: 'NOT_AUTHENTICATED',
      login: 'The login request was rejected.',
    });
    expect(positions).toHaveBeenCalledOnce();
  });

  it('reports a broken elicitation exchange as a failed login and logs it', async () => {
    const { useCases } = app();
    const logger = fakeLogger();
    const u = user({}, () => {
      throw new Error('client crashed');
    });
    const result = await (await open(useCases, u.elicit, logger)).call('get_account_positions');

    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(String((result.json as { login: string }).login)).toMatch(/^Login failed — .*client crashed/);
    expect(logger.warn).toHaveBeenCalledWith('login: guided login failed', expect.anything());
  });

  it('logs approval progress through the logger', async () => {
    const responses = [{ authenticated: false, status: 'pending', message: 'Still waiting…' }];
    let loggedIn = false;
    const { useCases } = app({
      login_complete: () => {
        const next = responses.shift();
        if (next) return next;
        loggedIn = true;
        return APPROVED;
      },
    });
    const gated = useCases.map((u) =>
      u.name === 'get_account_positions'
        ? new FakeQuery({
            name: 'get_account_positions',
            context: 'portfolio',
            handler: () => {
              if (!loggedIn) throw new NotAuthenticatedError();
              return { ok: true };
            },
          })
        : u,
    );
    const logger = fakeLogger();
    const result = await (await open(gated, user().elicit, logger)).call('get_account_positions');

    expect(result.json).toEqual({ ok: true });
    expect(logger.info).toHaveBeenCalledWith('login: Still waiting…');
  });

  it('runs one login for concurrent calls', async () => {
    const { useCases, spies, positions } = app();
    const u = user();
    const c = await open(useCases, u.elicit);
    const results = await Promise.all([c.call('get_account_positions'), c.call('get_account_positions')]);

    expect(results.every((r) => !r.isError)).toBe(true);
    expect(u.asked.filter((p) => fieldOf(p) === 'email')).toHaveLength(1);
    expect(spies.login_start).toHaveBeenCalledOnce();
    expect(positions).toHaveBeenCalledTimes(4);
  });

  it('starts a fresh login after a finished one', async () => {
    let loggedIn = false;
    const { useCases: login } = identityUseCases({});
    const tool = new FakeQuery({
      name: 'get_account_positions',
      context: 'portfolio',
      handler: () => {
        if (!loggedIn) throw new NotAuthenticatedError();
        loggedIn = false; // the session is lost again right away
        return { ok: true };
      },
    });
    const u = user({}, (params) => {
      if (fieldOf(params) === undefined) loggedIn = true;
      return null;
    });
    const c = await open([...login, tool], u.elicit);
    await c.call('get_account_positions');
    await c.call('get_account_positions');

    expect(u.asked.filter((p) => fieldOf(p) === 'email')).toHaveLength(2);
  });

  it('retries the tool only once, even if it still has no session after the login', async () => {
    const { useCases: login, spies } = identityUseCases({});
    const tool = vi.fn(() => {
      throw new NotAuthenticatedError();
    });
    const c = await open(
      [...login, new FakeQuery({ name: 'get_account_positions', context: 'portfolio', handler: tool })],
      user().elicit,
    );
    const result = await c.call('get_account_positions');

    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(result.json).not.toHaveProperty('login');
    expect(tool).toHaveBeenCalledTimes(2);
    expect(spies.login_start).toHaveBeenCalledOnce();
  });

  it('reports login progress to a client that asked for it', async () => {
    const responses = [{ authenticated: false, status: 'pending', message: 'Still waiting…' }];
    let loggedIn = false;
    const { useCases: login } = identityUseCases({
      login_complete: () => {
        const next = responses.shift();
        if (next) return next;
        loggedIn = true;
        return APPROVED;
      },
    });
    const tool = new FakeQuery({
      name: 'get_account_positions',
      context: 'portfolio',
      handler: () => {
        if (!loggedIn) throw new NotAuthenticatedError();
        return { ok: true };
      },
    });
    const c = await open([...login, tool], user().elicit);
    const progress: Array<{ progress: number; message?: string }> = [];
    await c.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
      onprogress: (p) => progress.push({ progress: p.progress, message: p.message }),
    });

    expect(progress).toEqual([{ progress: 1, message: 'Still waiting…' }]);
  });

  it('stops asking when the tool call is cancelled', async () => {
    const { useCases, spies } = app();
    const controller = new AbortController();
    let release: () => void = () => {};
    const elicit = vi.fn(
      (params: Params) =>
        new Promise<ElicitResult>((resolve) => {
          release = () => resolve({ action: 'accept', content: { email: 'me@example.com' } });
          if (fieldOf(params) === 'email') controller.abort();
        }),
    );
    const c = await open(useCases, elicit);
    await expect(
      c.client.callTool({ name: 'get_account_positions', arguments: {} }, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    release();
    await vi.waitFor(() => expect(spies.auth_status).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(elicit).toHaveBeenCalledOnce();
    expect(spies.login_start).not.toHaveBeenCalled();
  });

  it('leaves the error untouched when the client cannot elicit', async () => {
    const { useCases, spies } = app();
    const result = await (await open(useCases)).call('get_account_positions');

    expect(result.isError).toBe(true);
    expect(result.json).toEqual({ error: 'NOT_AUTHENTICATED', message: new NotAuthenticatedError().message });
    expect(spies.auth_status).not.toHaveBeenCalled();
  });

  it('never starts a login from the identity tools themselves', async () => {
    const { useCases } = app({
      login_complete: () => {
        throw new NotAuthenticatedError('Firebase identity lost. Call login_start again.');
      },
    });
    const u = user();
    const result = await (await open(useCases, u.elicit)).call('login_complete');

    expect(result.json).toMatchObject({ error: 'NOT_AUTHENTICATED' });
    expect(u.elicit).not.toHaveBeenCalled();
  });

  it('does not log in for other errors', async () => {
    const { useCases } = app({}, () => new Error('boom'));
    const u = user();
    const result = await (await open(useCases, u.elicit)).call('get_account_positions');

    expect(result.json).toMatchObject({ error: 'INTERNAL_ERROR' });
    expect(u.elicit).not.toHaveBeenCalled();
  });
});

describe('LoginOnDemand', () => {
  it('reports a non-Error rejection from the client as a failed login', async () => {
    const { useCases } = identityUseCases({});
    const server = {
      getClientCapabilities: () => ({ elicitation: { form: {} } }),
      elicitInput: () => Promise.reject('connection closed'),
    } as unknown as Server;
    const login = new LoginOnDemand(server, useCases);

    expect(await login.login()).toEqual({ ok: false, message: 'Login failed — connection closed' });
  });
});

describe('elicitationDialog', () => {
  it('logs progress it could not deliver instead of failing the login', async () => {
    const logger = fakeLogger();
    const dialog = elicitationDialog({} as Server, logger, {
      progress: () => Promise.reject(new Error('closed')),
    });
    dialog.notify('Still waiting…');
    await vi.waitFor(() =>
      expect(logger.debug).toHaveBeenCalledWith('login: progress not delivered', expect.anything()),
    );
    expect(logger.info).toHaveBeenCalledWith('login: Still waiting…');
  });
});
