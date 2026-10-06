import { describe, expect, it, vi } from 'vitest';
import { APPROVAL, APPROVED, identityUseCases } from '../../../__tests__/support/fake-login';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { terminalDisclaimer } from '../../presenters/disclaimer';
import { renderQr } from '../../presenters/qr';
import { EXIT_FAILURE, EXIT_OK } from '../cli';
import { runLoginCommand } from '../login-command';

function io(answers: string[] = []) {
  const printed: string[] = [];
  const prompts: string[] = [];
  return {
    printed,
    prompts,
    io: {
      prompt: vi.fn(async (q: string) => {
        prompts.push(q);
        return answers.shift() ?? '';
      }),
      print: (line: string) => printed.push(line),
    },
  };
}

describe('runLoginCommand', () => {
  it('runs the email flow: status → start → verify code → complete', async () => {
    const { useCases, spies } = identityUseCases({});
    const t = io(['  me@example.com  ', ' 123456 ']);
    expect(await runLoginCommand(useCases, t.io)).toBe(EXIT_OK);
    expect(t.prompts).toEqual(['Thndr account email: ', 'Verification code: ']);
    expect(spies.auth_status).toHaveBeenCalledWith({});
    expect(spies.login_start).toHaveBeenCalledWith({ email: 'me@example.com' });
    expect(spies.login_verify_code).toHaveBeenCalledWith({ code: '123456' });
    expect(spies.login_complete).toHaveBeenCalledWith({ timeoutSeconds: 60 });
    expect(spies.login_request_approval).not.toHaveBeenCalled();
    expect(t.printed.slice(0, 2)).toEqual([terminalDisclaimer(), '']);
    expect(t.printed.slice(2)).toEqual([
      'Code sent to m***@example.com.',
      APPROVAL.message,
      renderQr(APPROVAL.deepLink),
      `Deep link (open on your phone): ${APPROVAL.deepLink}`,
      '✔ Logged in. Session valid until 2026-03-01T16:00:00.000Z.',
    ]);
  });

  it('requests a phone approval directly when already identified', async () => {
    const { useCases, spies } = identityUseCases({
      auth_status: () => ({ authenticated: false, identified: true }),
      login_complete: () => ({ authenticated: true, message: 'Welcome back.' }),
    });
    const t = io();
    expect(await runLoginCommand(useCases, t.io)).toBe(EXIT_OK);
    expect(t.io.prompt).not.toHaveBeenCalled();
    expect(spies.login_start).not.toHaveBeenCalled();
    expect(spies.login_request_approval).toHaveBeenCalledOnce();
    expect(t.printed.slice(0, 2)).toEqual([terminalDisclaimer(), '']);
    expect(t.printed.slice(2)).toEqual([
      'Already identified with Thndr. Requesting a new approval on your phone…',
      APPROVAL.message,
      renderQr(APPROVAL.deepLink),
      `Deep link (open on your phone): ${APPROVAL.deepLink}`,
      '✔ Welcome back. Session valid until the server ends it.',
    ]);
  });

  it('keeps waiting while the approval is pending or unknown, then succeeds', async () => {
    const responses = [
      { authenticated: false, status: 'pending', message: 'Still waiting…' },
      { authenticated: false, status: 'unknown', message: 'Status unknown…' },
      APPROVED,
    ];
    const { useCases, spies } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_complete: () => responses.shift(),
    });
    const t = io();
    expect(await runLoginCommand(useCases, t.io)).toBe(EXIT_OK);
    expect(spies.login_complete).toHaveBeenCalledTimes(3);
    expect(t.printed.slice(-3)).toEqual([
      'Still waiting…',
      'Status unknown…',
      '✔ Logged in. Session valid until 2026-03-01T16:00:00.000Z.',
    ]);
  });

  it('fails when the request is rejected', async () => {
    const { useCases, spies } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_complete: () => ({
        authenticated: false,
        status: 'rejected',
        message: 'The request was rejected.',
      }),
    });
    const t = io();
    expect(await runLoginCommand(useCases, t.io)).toBe(EXIT_FAILURE);
    expect(spies.login_complete).toHaveBeenCalledOnce();
    expect(t.printed.at(-1)).toBe('The request was rejected.');
  });

  it('gives up after the configured number of attempts', async () => {
    const { useCases, spies } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_complete: () => ({ authenticated: false, status: 'pending', message: 'Pending.' }),
    });
    const t = io();
    expect(await runLoginCommand(useCases, t.io, 2)).toBe(EXIT_FAILURE);
    expect(spies.login_complete).toHaveBeenCalledTimes(2);
    expect(t.printed.slice(-3)).toEqual(['Pending.', 'Pending.', 'Gave up waiting for approval.']);
  });

  it('tries five times by default', async () => {
    const { useCases, spies } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_complete: () => ({ authenticated: false, status: 'pending', message: 'Pending.' }),
    });
    expect(await runLoginCommand(useCases, io().io)).toBe(EXIT_FAILURE);
    expect(spies.login_complete).toHaveBeenCalledTimes(5);
  });

  it('reports a failing step as "Login failed — CODE: message" and stops', async () => {
    const { useCases, spies } = identityUseCases({
      login_start: () => {
        throw new ValidationError('Invalid email address');
      },
    });
    const t = io(['nope']);
    expect(await runLoginCommand(useCases, t.io)).toBe(EXIT_FAILURE);
    expect(spies.login_verify_code).not.toHaveBeenCalled();
    expect(t.printed.slice(0, 2)).toEqual([terminalDisclaimer(), '']);
    expect(t.printed.slice(2)).toEqual(['Login failed — VALIDATION_ERROR: Invalid email address']);
  });

  it('throws when a login use case is not registered', async () => {
    const { useCases } = identityUseCases({});
    await expect(
      runLoginCommand(
        useCases.filter((u) => u.name !== 'auth_status'),
        io().io,
      ),
    ).rejects.toThrow('Use case auth_status is not registered');
  });
});
