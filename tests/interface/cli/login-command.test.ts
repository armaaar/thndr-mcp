import { describe, expect, it } from 'vitest';
import type * as L from '../../../src/application/identity/login.js';
import { runLoginCommand } from '../../../src/interface/cli/login-command.js';
import { stub } from '../../support/use-case-stub.js';

const instructions = { humanId: '42', requestId: 'r', deepLink: 'thndr://go', message: 'Approve it' };

function deps(identified: boolean, ...completions: unknown[]) {
  const completeLogin = stub<L.CompleteLogin>();
  for (const c of completions) completeLogin.execute.mockResolvedValueOnce(c);
  return {
    getAuthStatus: stub<L.GetAuthStatus>({ identified }),
    startLogin: stub<L.StartLogin>({ message: 'Code sent' }),
    verifyLoginCode: stub<L.VerifyLoginCode>(instructions),
    requestDeviceApproval: stub<L.RequestDeviceApproval>(instructions),
    completeLogin,
  };
}

function io(answers: string[]) {
  const lines: string[] = [];
  return {
    lines,
    prompt: async () => answers.shift() ?? '',
    print: (l: string) => lines.push(l),
  };
}

describe('runLoginCommand', () => {
  it('runs the full email + approval flow', async () => {
    const d = deps(false, {
      status: 'approved',
      authenticated: true,
      message: 'Logged in.',
      sessionExpiresAt: 'X',
    });
    const terminal = io([' me@x.com ', ' 123456 ']);
    expect(await runLoginCommand(d, terminal)).toBe(0);
    expect(d.startLogin.execute).toHaveBeenCalledWith({ email: 'me@x.com' });
    expect(d.verifyLoginCode.execute).toHaveBeenCalledWith({ code: '123456' });
    expect(terminal.lines).toEqual([
      'Code sent',
      'Approve it',
      'Deep link (open on your phone): thndr://go',
      '✔ Logged in. Session valid until X.',
    ]);
  });

  it('skips the email step when already identified and keeps waiting while pending', async () => {
    const d = deps(
      true,
      { status: 'pending', authenticated: false, message: 'waiting' },
      { status: 'approved', authenticated: true, message: 'ok', sessionExpiresAt: null },
    );
    const terminal = io([]);
    expect(await runLoginCommand(d, terminal)).toBe(0);
    expect(d.requestDeviceApproval.execute).toHaveBeenCalled();
    expect(d.startLogin.execute).not.toHaveBeenCalled();
    expect(terminal.lines.at(-1)).toBe('✔ ok Session valid until the server ends it.');
  });

  it('fails on rejection and gives up after the attempts', async () => {
    const rejected = deps(true, { status: 'rejected', authenticated: false, message: 'rejected' });
    expect(await runLoginCommand(rejected, io([]))).toBe(1);
    const pending = { status: 'unknown', authenticated: false, message: 'waiting' };
    const slow = deps(true, pending, pending);
    const terminal = io([]);
    expect(await runLoginCommand(slow, terminal, 2)).toBe(1);
    expect(terminal.lines.at(-1)).toBe('Gave up waiting for approval.');
  });
});
