import { vi } from 'vitest';
import type { LoginDependencies } from '../../application/identity/dependencies';
import type { Clock } from '../../application/ports/clock';
import type { IdentityProvider, IssuedAccess, ThndrAuthGateway } from '../../application/ports/identity';
import type { Logger } from '../../application/ports/logger';
import { DeviceApprovalRequest } from '../../domain/identity/device-approval';
import type { SessionRepository } from '../../domain/identity/repository';
import type { ThndrSession } from '../../domain/identity/thndr-session';
import { InMemoryLoginFlowRepository } from '../../repositories/memory/login-flow-repository';

export const T0 = new Date('2026-01-01T00:00:00Z');

/** A clock whose time can be moved forward by tests. */
export function mutableClock(start: Date = T0): Clock & { advance(ms: number): void; set(date: Date): void } {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
    set: (date: Date) => {
      current = date.getTime();
    },
  };
}

export class InMemorySessionRepository implements SessionRepository {
  saves: ThndrSession[] = [];
  clears = 0;

  constructor(public session: ThndrSession | null = null) {}

  async load(): Promise<ThndrSession | null> {
    return this.session;
  }

  async save(session: ThndrSession): Promise<void> {
    this.saves.push(session);
    this.session = session;
  }

  async clear(): Promise<void> {
    this.clears++;
    this.session = null;
  }
}

export function issued(overrides: Partial<IssuedAccess> = {}): IssuedAccess {
  return {
    accessToken: 'new-token',
    accessTokenExpiresAt: new Date(T0.getTime() + 15 * 60_000),
    cookies: {},
    refreshExpiresAt: null,
    ...overrides,
  };
}

export const approvalRequest = DeviceApprovalRequest.of({
  id: 'req-1',
  secret: 'secret-1',
  humanId: '4242',
  createdAt: T0,
});

/** A gateway of `vi.fn` spies; overrides are wrapped in spies too. */
export function fakeGateway(overrides: Partial<ThndrAuthGateway> = {}) {
  const spied = Object.fromEntries(
    Object.entries(overrides).map(([key, fn]) => [key, vi.isMockFunction(fn) ? fn : vi.fn(fn)]),
  ) as Partial<ThndrAuthGateway>;
  return {
    sendEmailCode: vi.fn(async (_email: string) => 'verification-1'),
    verifyEmailCode: vi.fn(async (_id: string, _code: string) => 'custom-token'),
    createApprovalRequest: vi.fn(async (_idToken: string) => approvalRequest),
    getApprovalStatus: vi.fn(async () => 'approved' as const),
    exchangeApproval: vi.fn(async () => issued({ cookies: { sid: 'r1' } })),
    refreshAccess: vi.fn(async () => issued()),
    logout: vi.fn(async () => undefined),
    ...(spied as Record<string, never>),
  } satisfies ThndrAuthGateway;
}

export function fakeIdentity(idToken: string | null = 'id-token') {
  return {
    signInWithCustomToken: vi.fn(async (_token: string) => undefined),
    getIdToken: vi.fn(async (): Promise<string | null> => idToken),
    signOut: vi.fn(async () => undefined),
  } satisfies IdentityProvider;
}

export function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

export const DEVICE_NAME = 'thndr-mcp';

/** Login use-case dependencies built from fakes; `sleep` advances the mutable clock. */
export function loginDeps(
  overrides: {
    gateway?: ReturnType<typeof fakeGateway>;
    identity?: ReturnType<typeof fakeIdentity>;
    pollIntervalMs?: number;
  } = {},
) {
  const clock = mutableClock();
  return {
    gateway: overrides.gateway ?? fakeGateway(),
    identity: overrides.identity ?? fakeIdentity(),
    sessions: new InMemorySessionRepository(),
    flow: new InMemoryLoginFlowRepository(),
    clock,
    sleep: vi.fn(async (ms: number) => clock.advance(ms)),
    deviceName: DEVICE_NAME,
    ...(overrides.pollIntervalMs === undefined ? {} : { pollIntervalMs: overrides.pollIntervalMs }),
  } satisfies LoginDependencies;
}

/** Puts the login flow in AWAITING_APPROVAL for `request`. */
export function awaitingApproval(
  d: ReturnType<typeof loginDeps>,
  request: DeviceApprovalRequest = approvalRequest,
) {
  void d.flow.save(d.flow.current.awaitingApproval(request));
}
