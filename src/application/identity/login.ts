import { AccessToken } from '../../domain/identity/access-token.js';
import type { ApprovalStatus, DeviceApprovalRequest } from '../../domain/identity/device-approval.js';
import { Email } from '../../domain/identity/email.js';
import { RefreshCredential } from '../../domain/identity/refresh-credential.js';
import { ThndrSession } from '../../domain/identity/thndr-session.js';
import { ValidationError } from '../../domain/shared/errors.js';
import { assertNonEmpty } from '../../domain/shared/guards.js';
import { NotAuthenticatedError, UpstreamError } from '../errors.js';
import type { Clock } from '../ports/clock.js';
import type { IdentityProvider, SessionRepository, ThndrAuthGateway } from '../ports/identity.js';
import type { LoginFlowHolder } from './login-flow-holder.js';

export interface LoginDependencies {
  gateway: ThndrAuthGateway;
  identity: IdentityProvider;
  sessions: SessionRepository;
  flow: LoginFlowHolder;
  clock: Clock;
  /** User agent shown to the user in the Thndr app approval screen. */
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ApprovalInstructions {
  humanId: string;
  deepLink: string;
  requestId: string;
  message: string;
}

function instructions(request: DeviceApprovalRequest, userAgent: string): ApprovalInstructions {
  return {
    humanId: request.humanId,
    requestId: request.id,
    deepLink: request.deepLink(userAgent),
    message:
      'Open the Thndr app on your phone and approve the new login request' +
      (request.humanId ? ` (code ${request.humanId})` : '') +
      ', or open the deep link on the phone. Then call login_complete.',
  };
}

/** Step 1: mail a 6-digit code to the user's Thndr email. */
export class StartLogin {
  constructor(private readonly deps: LoginDependencies) {}

  async execute(input: { email: string }): Promise<{ maskedEmail: string; message: string }> {
    const email = Email.of(input.email);
    const verificationId = await this.deps.gateway.sendEmailCode(email.value);
    this.deps.flow.set(this.deps.flow.current.codeSent(email, verificationId));
    return {
      maskedEmail: email.masked(),
      message: `A 6-digit verification code was sent to ${email.masked()}. Call login_verify_code with it.`,
    };
  }
}

/** Step 2: verify the code, sign in to Firebase and create the device-approval request. */
export class VerifyLoginCode {
  constructor(private readonly deps: LoginDependencies) {}

  async execute(input: { code: string }): Promise<ApprovalInstructions> {
    const code = assertNonEmpty(input.code, 'Verification code').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(code)) throw new ValidationError('Verification code must be 4–8 digits');
    const { verificationId } = this.deps.flow.current.requireCodeSent();
    const customToken = await this.deps.gateway.verifyEmailCode(verificationId, code);
    await this.deps.identity.signInWithCustomToken(customToken);
    return new RequestDeviceApproval(this.deps).execute();
  }
}

/** Creates a device-approval request for an already identified (Firebase) user — no OTP needed. */
export class RequestDeviceApproval {
  constructor(private readonly deps: LoginDependencies) {}

  async execute(): Promise<ApprovalInstructions> {
    const idToken = await this.deps.identity.getIdToken();
    if (!idToken) {
      throw new NotAuthenticatedError(
        'Not identified with Thndr yet. Call login_start with your email first.',
      );
    }
    const request = await this.deps.gateway.createApprovalRequest(idToken);
    this.deps.flow.set(this.deps.flow.current.awaitingApproval(request));
    return instructions(request, this.deps.userAgent);
  }
}

export interface CompleteLoginResult {
  status: ApprovalStatus;
  authenticated: boolean;
  message: string;
  accessTokenExpiresAt?: string;
  sessionExpiresAt?: string | null;
}

/** Step 3: wait for the phone approval, then exchange it for a session and persist it. */
export class CompleteLogin {
  constructor(private readonly deps: LoginDependencies) {}

  async execute(
    input: { timeoutSeconds?: number; pollIntervalMs?: number } = {},
  ): Promise<CompleteLoginResult> {
    const request = this.deps.flow.current.requireAwaitingApproval();
    const idToken = await this.deps.identity.getIdToken();
    if (!idToken) throw new NotAuthenticatedError('Firebase identity lost. Call login_start again.');
    const timeoutMs = Math.min(Math.max(input.timeoutSeconds ?? 60, 0), 300) * 1000;
    const interval = Math.max(input.pollIntervalMs ?? 1000, 10);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = this.deps.clock.now().getTime() + timeoutMs;

    let status = await this.deps.gateway.getApprovalStatus(request, idToken);
    while (status === 'pending' || status === 'unknown') {
      if (this.deps.clock.now().getTime() >= deadline) {
        return {
          status,
          authenticated: false,
          message: 'Still waiting for approval in the Thndr app. Approve it, then call login_complete again.',
        };
      }
      await sleep(interval);
      status = await this.deps.gateway.getApprovalStatus(request, idToken);
    }

    if (status === 'rejected' || status === 'expired') {
      this.deps.flow.reset();
      return {
        status,
        authenticated: false,
        message: `The login request was ${status}. Call login_request_approval to try again.`,
      };
    }
    if (status === 'claimed') {
      this.deps.flow.reset();
      throw new UpstreamError(
        'This approval was already used. Call login_request_approval to create a new one.',
      );
    }

    const issued = await this.deps.gateway.exchangeApproval(request, idToken);
    const now = this.deps.clock.now();
    const session = ThndrSession.establish(
      RefreshCredential.of(issued.cookies, issued.refreshExpiresAt),
      AccessToken.of(issued.accessToken, issued.accessTokenExpiresAt),
      now,
    );
    await this.deps.sessions.save(session);
    this.deps.flow.reset();
    return {
      status,
      authenticated: true,
      message: 'Logged in to Thndr.',
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      sessionExpiresAt: issued.refreshExpiresAt?.toISOString() ?? null,
    };
  }
}

/** Fallback (ADR 0007): import an authenticated x.thndr.app browser session from its Cookie header. */
export class ImportSession {
  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'sessions' | 'clock'>) {}

  async execute(input: {
    cookieHeader: string;
  }): Promise<{ authenticated: true; accessTokenExpiresAt: string }> {
    const refresh = RefreshCredential.fromCookieHeader(assertNonEmpty(input.cookieHeader, 'Cookie header'));
    const issued = await this.deps.gateway.refreshAccess(refresh);
    const merged = refresh.merge(issued.cookies, issued.refreshExpiresAt);
    const session = ThndrSession.establish(
      merged,
      AccessToken.of(issued.accessToken, issued.accessTokenExpiresAt),
      this.deps.clock.now(),
    );
    await this.deps.sessions.save(session);
    return { authenticated: true, accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString() };
  }
}

export interface AuthStatus {
  authenticated: boolean;
  identified: boolean;
  pendingStep: 'none' | 'verify_code' | 'approve_on_phone';
  accessTokenExpiresAt: string | null;
  sessionExpiresAt: string | null;
  sessionEstablishedAt: string | null;
}

export class GetAuthStatus {
  constructor(private readonly deps: Pick<LoginDependencies, 'identity' | 'sessions' | 'flow' | 'clock'>) {}

  async execute(): Promise<AuthStatus> {
    const [session, idToken] = await Promise.all([
      this.deps.sessions.load(),
      this.deps.identity.getIdToken().catch(() => null),
    ]);
    const stage = this.deps.flow.current.stage;
    const now = this.deps.clock.now();
    return {
      authenticated: session !== null && !session.refresh.isExpired(now),
      identified: idToken !== null,
      pendingStep:
        stage === 'CODE_SENT' ? 'verify_code' : stage === 'AWAITING_APPROVAL' ? 'approve_on_phone' : 'none',
      accessTokenExpiresAt: session?.accessToken?.expiresAt.toISOString() ?? null,
      sessionExpiresAt: session?.refresh.expiresAt?.toISOString() ?? null,
      sessionEstablishedAt: session?.establishedAt.toISOString() ?? null,
    };
  }
}

export class Logout {
  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'sessions' | 'flow'>) {}

  async execute(input: { forgetIdentity?: boolean } = {}): Promise<{ loggedOut: true }> {
    const session = await this.deps.sessions.load();
    if (session) {
      // Best effort: the local session is discarded even if Thndr cannot be reached.
      await this.deps.gateway.logout(session.refresh).catch(() => undefined);
      await this.deps.sessions.clear();
    }
    if (input.forgetIdentity) await this.deps.identity.signOut();
    this.deps.flow.reset();
    return { loggedOut: true };
  }
}
