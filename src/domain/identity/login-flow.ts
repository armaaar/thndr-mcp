import { BusinessRuleViolation } from '../shared-kernel/errors';
import type { DeviceApprovalRequest } from './device-approval';
import type { Email } from './email';

export type LoginStage = 'IDLE' | 'CODE_SENT' | 'AWAITING_APPROVAL';

/**
 * State machine of an interactive login (ADR 0007):
 * IDLE → CODE_SENT (email OTP mailed) → AWAITING_APPROVAL (approve on phone) → IDLE (session established).
 * Re-approval for an already identified user goes IDLE → AWAITING_APPROVAL directly.
 */
export class LoginFlow {
  private constructor(
    readonly stage: LoginStage,
    readonly email: Email | null,
    readonly verificationId: string | null,
    readonly approval: DeviceApprovalRequest | null,
  ) {
    Object.freeze(this);
  }

  /** Rehydrates a persisted flow (repositories only). */
  static restore(input: {
    stage: LoginStage;
    email: Email | null;
    verificationId: string | null;
    approval: DeviceApprovalRequest | null;
  }): LoginFlow {
    return new LoginFlow(input.stage, input.email, input.verificationId, input.approval);
  }

  static idle(): LoginFlow {
    return new LoginFlow('IDLE', null, null, null);
  }

  codeSent(email: Email, verificationId: string): LoginFlow {
    return new LoginFlow('CODE_SENT', email, verificationId, null);
  }

  awaitingApproval(approval: DeviceApprovalRequest): LoginFlow {
    return new LoginFlow('AWAITING_APPROVAL', this.email, null, approval);
  }

  requireCodeSent(): { email: Email; verificationId: string } {
    if (this.stage !== 'CODE_SENT' || !this.email || !this.verificationId) {
      throw new BusinessRuleViolation(
        'LOGIN_NOT_STARTED',
        'No verification code was requested. Call login_start first.',
      );
    }
    return { email: this.email, verificationId: this.verificationId };
  }

  requireAwaitingApproval(): DeviceApprovalRequest {
    if (this.stage !== 'AWAITING_APPROVAL' || !this.approval) {
      throw new BusinessRuleViolation(
        'NO_PENDING_APPROVAL',
        'There is no pending device approval. Call login_verify_code or login_request_approval first.',
      );
    }
    return this.approval;
  }
}
