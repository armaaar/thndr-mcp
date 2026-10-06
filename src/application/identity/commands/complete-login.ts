import { z } from 'zod';
import { AccessToken } from '../../../domain/identity/access-token';
import type { ApprovalStatus } from '../../../domain/identity/device-approval';
import { LoginFlow } from '../../../domain/identity/login-flow';
import { RefreshCredential } from '../../../domain/identity/refresh-credential';
import { ThndrSession } from '../../../domain/identity/thndr-session';
import { NotAuthenticatedError, UpstreamError } from '../../errors';
import { Command, type InputOf } from '../../use-case';
import type { LoginDependencies } from '../dependencies';

const input = {
  timeoutSeconds: z.number().int().min(0).max(300).default(60).describe('How long to wait for approval'),
};

export interface CompleteLoginResult {
  status: ApprovalStatus;
  authenticated: boolean;
  message: string;
  accessTokenExpiresAt?: string;
  sessionExpiresAt?: string | null;
}

/** Step 3: wait for the phone approval, then exchange it for a session and persist it. */
export class CompleteLogin extends Command<typeof input, CompleteLoginResult> {
  readonly name = 'login_complete';
  readonly title = 'Complete Thndr login';
  readonly description =
    'Step 3 of 3. Waits (up to timeoutSeconds) for the user to approve the login in the Thndr mobile app, then ' +
    'stores the session. If it returns authenticated=false with status pending, call it again after the user approves.';
  readonly context = 'identity';
  readonly input = input;
  override readonly idempotent = true;

  constructor(private readonly deps: LoginDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input> = {}): Promise<CompleteLoginResult> {
    const request = (await this.deps.flow.load()).requireAwaitingApproval();
    const idToken = await this.deps.identity.getIdToken();
    if (!idToken) throw new NotAuthenticatedError('Firebase identity lost. Call login_start again.');
    const timeoutMs = Math.min(Math.max(params.timeoutSeconds ?? 60, 0), 300) * 1000;
    const interval = Math.max(this.deps.pollIntervalMs ?? 1000, 10);
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
      await this.deps.flow.save(LoginFlow.idle());
      return {
        status,
        authenticated: false,
        message: `The login request was ${status}. Call login_request_approval to try again.`,
      };
    }
    if (status === 'claimed') {
      await this.deps.flow.save(LoginFlow.idle());
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
    await this.deps.flow.save(LoginFlow.idle());
    return {
      status,
      authenticated: true,
      message: 'Logged in to Thndr.',
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      sessionExpiresAt: issued.refreshExpiresAt?.toISOString() ?? null,
    };
  }
}
