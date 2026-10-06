import { vi } from 'vitest';
import { z } from 'zod';
import { FakeCommand, FakeQuery } from './fake-use-cases';

type Handler = (input: Record<string, unknown>) => unknown;
export type LoginHandlers = Partial<
  Record<
    'auth_status' | 'login_start' | 'login_verify_code' | 'login_request_approval' | 'login_complete',
    Handler
  >
>;

export const APPROVAL = {
  message: 'Approve request H7 in the Thndr app.',
  humanId: 'H7',
  deepLink: 'thndr://approve?requestId=req-1',
};

export const APPROVED = {
  authenticated: true,
  status: 'approved',
  message: 'Logged in.',
  sessionExpiresAt: '2026-03-01T16:00:00.000Z',
};

/** The identity use cases the guided login drives, as concrete fakes with spied behaviour. */
export function identityUseCases(handlers: LoginHandlers) {
  const spies = {
    auth_status: vi.fn(handlers.auth_status ?? (() => ({ authenticated: false, identified: false }))),
    login_start: vi.fn(handlers.login_start ?? (() => ({ message: 'Code sent to m***@example.com.' }))),
    login_verify_code: vi.fn(handlers.login_verify_code ?? (() => APPROVAL)),
    login_request_approval: vi.fn(handlers.login_request_approval ?? (() => APPROVAL)),
    login_complete: vi.fn(handlers.login_complete ?? (() => APPROVED)),
  };
  const useCases = [
    new FakeQuery({ name: 'auth_status', local: true, handler: spies.auth_status }),
    new FakeCommand({
      context: 'identity',
      name: 'login_start',
      input: { email: z.string() },
      handler: spies.login_start,
    }),
    new FakeCommand({
      context: 'identity',
      name: 'login_verify_code',
      input: { code: z.string() },
      handler: spies.login_verify_code,
    }),
    new FakeCommand({
      context: 'identity',
      name: 'login_request_approval',
      handler: spies.login_request_approval,
    }),
    new FakeCommand({
      context: 'identity',
      name: 'login_complete',
      input: { timeoutSeconds: z.number().int().min(0).default(30) },
      handler: spies.login_complete,
    }),
  ];
  return { useCases, spies };
}
