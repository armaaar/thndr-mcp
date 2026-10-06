import { describe, expect, it, vi } from 'vitest';
import { APPROVAL, identityUseCases } from '../../../__tests__/support/fake-login';
import { NotAuthenticatedError } from '../../../application/errors';
import { forPerson, type LoginDialog, runGuidedLogin } from '../guided-login';

function dialog(overrides: Partial<LoginDialog> = {}) {
  return {
    askEmail: vi.fn(async (): Promise<string | null> => 'me@example.com'),
    askCode: vi.fn(async (_sent: string): Promise<string | null> => '123456'),
    confirmApproval: vi.fn(async () => true),
    notify: vi.fn(),
    ...overrides,
  } satisfies LoginDialog;
}

describe('runGuidedLogin', () => {
  it('asks for the email, then the code (saying where it was sent), then the approval', async () => {
    const { useCases, spies } = identityUseCases({});
    const d = dialog();
    expect(await runGuidedLogin(useCases, d)).toEqual({
      ok: true,
      message: '✔ Logged in. Session valid until 2026-03-01T16:00:00.000Z.',
    });
    expect(d.askCode).toHaveBeenCalledWith('Code sent to m***@example.com.');
    expect(d.confirmApproval).toHaveBeenCalledWith(APPROVAL);
    expect(spies.login_start).toHaveBeenCalledWith({ email: 'me@example.com' });
    expect(spies.login_verify_code).toHaveBeenCalledWith({ code: '123456' });
  });

  it.each([
    ['the email question', { askEmail: async () => null }],
    ['the email question with a blank answer', { askEmail: async () => '   ' }],
    ['the code question', { askCode: async () => null }],
  ])('stops without calling Thndr further when the user cancels %s', async (_, overrides) => {
    const { useCases, spies } = identityUseCases({});
    expect(await runGuidedLogin(useCases, dialog(overrides))).toEqual({
      ok: false,
      message: 'Login cancelled.',
    });
    expect(spies.login_verify_code).not.toHaveBeenCalled();
    expect(spies.login_complete).not.toHaveBeenCalled();
  });

  it('does not wait for an approval the user declined to give', async () => {
    const { useCases, spies } = identityUseCases({});
    const result = await runGuidedLogin(useCases, dialog({ confirmApproval: async () => false }));
    expect(result).toEqual({ ok: false, message: 'Login cancelled.' });
    expect(spies.login_complete).not.toHaveBeenCalled();
  });

  it('reports pending approvals through notify', async () => {
    const responses = [{ authenticated: false, status: 'pending', message: 'Still waiting…' }];
    const { useCases } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_complete: () => responses.shift() ?? { authenticated: true, message: 'Welcome back.' },
    });
    const notify = vi.fn();
    const d = dialog({ notify });
    expect(await runGuidedLogin(useCases, d)).toEqual({
      ok: true,
      message: '✔ Welcome back. Session valid until the server ends it.',
    });
    expect(d.askEmail).not.toHaveBeenCalled();
    expect(notify.mock.calls).toEqual([
      ['Already identified with Thndr. Requesting a new approval on your phone…'],
      ['Still waiting…'],
    ]);
  });
});

describe('forPerson', () => {
  it('drops the sentences that tell an agent which tool to call', () => {
    expect(
      forPerson('A 6-digit verification code was sent to m***@example.com. Call login_verify_code with it.'),
    ).toBe('A 6-digit verification code was sent to m***@example.com.');
    expect(
      forPerson('Still waiting for approval in the Thndr app. Approve it, then call login_complete again.'),
    ).toBe('Still waiting for approval in the Thndr app.');
    expect(forPerson('Logged in.')).toBe('Logged in.');
  });

  it('is applied to every message the guided login shows', async () => {
    const { useCases } = identityUseCases({
      login_start: () => ({ message: 'Code sent to m***@example.com. Call login_verify_code with it.' }),
      login_verify_code: () => ({ ...APPROVAL, message: `${APPROVAL.message} Then call login_complete.` }),
      login_complete: () => ({
        authenticated: false,
        status: 'expired',
        message: 'Expired. Call login_request_approval.',
      }),
    });
    const d = dialog();
    expect(await runGuidedLogin(useCases, d)).toEqual({ ok: false, message: 'Expired.' });
    expect(d.askCode).toHaveBeenCalledWith('Code sent to m***@example.com.');
    expect(d.confirmApproval).toHaveBeenCalledWith(APPROVAL);
  });

  it('is applied to failed steps', async () => {
    const { useCases } = identityUseCases({
      auth_status: () => ({ identified: true }),
      login_request_approval: () => {
        throw new NotAuthenticatedError(
          'Not identified with Thndr yet. Call login_start with your email first.',
        );
      },
    });
    expect(await runGuidedLogin(useCases, dialog())).toEqual({
      ok: false,
      message: 'Login failed — NOT_AUTHENTICATED: Not identified with Thndr yet.',
    });
  });
});
