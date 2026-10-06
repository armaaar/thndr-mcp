import { Command } from '../../use-case';
import type { ApprovalInstructions } from '../approval-instructions';
import type { LoginDependencies } from '../dependencies';
import { DeviceApprovalRequester } from '../services/device-approval-requester';

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

  constructor(
    private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'flow' | 'deviceName'>,
  ) {
    super();
  }

  async execute(): Promise<ApprovalInstructions> {
    return new DeviceApprovalRequester(this.deps).request();
  }
}
