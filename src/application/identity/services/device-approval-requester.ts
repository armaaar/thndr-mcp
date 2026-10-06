import { NotAuthenticatedError } from '../../errors';
import { type ApprovalInstructions, approvalInstructions } from '../approval-instructions';
import type { LoginDependencies } from '../dependencies';

/**
 * Application service shared by the login commands: creates a device-approval request for the identified Firebase
 * user, records it in the login flow and returns what the user must do on their phone.
 */
export class DeviceApprovalRequester {
  constructor(
    private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'flow' | 'deviceName'>,
  ) {}

  async request(): Promise<ApprovalInstructions> {
    const idToken = await this.deps.identity.getIdToken();
    if (!idToken) {
      throw new NotAuthenticatedError(
        'Not identified with Thndr yet. Call login_start with your email first.',
      );
    }
    const request = await this.deps.gateway.createApprovalRequest(idToken);
    await this.deps.flow.save((await this.deps.flow.load()).awaitingApproval(request));
    return approvalInstructions(request, this.deps.deviceName);
  }
}
