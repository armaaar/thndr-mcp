import { NotAuthenticatedError } from '../../errors';
import { Command } from '../../use-case';
import { type ApprovalInstructions, approvalInstructions } from '../approval-instructions';
import type { LoginDependencies } from '../dependencies';

const input = {};

/** Creates a device-approval request for an already identified (Firebase) user — no OTP needed. */
export class RequestDeviceApproval extends Command<typeof input, ApprovalInstructions> {
  readonly name = 'login_request_approval';
  readonly title = 'Request phone approval';
  readonly description =
    'Creates a new login request for an already identified user (no email code needed). Use it when the session ' +
    'expired (SESSION_EXPIRED). The user approves it in the Thndr mobile app. Next: login_complete.';
  readonly context = 'identity';
  readonly input = input;

  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'flow' | 'userAgent'>) {
    super();
  }

  async execute(): Promise<ApprovalInstructions> {
    const idToken = await this.deps.identity.getIdToken();
    if (!idToken) {
      throw new NotAuthenticatedError(
        'Not identified with Thndr yet. Call login_start with your email first.',
      );
    }
    const request = await this.deps.gateway.createApprovalRequest(idToken);
    await this.deps.flow.save((await this.deps.flow.load()).awaitingApproval(request));
    return approvalInstructions(request, this.deps.userAgent);
  }
}
