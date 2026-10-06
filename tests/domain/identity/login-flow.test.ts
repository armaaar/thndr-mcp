import { describe, expect, it } from 'vitest';
import { DeviceApprovalRequest } from '../../../src/domain/identity/device-approval';
import { Email } from '../../../src/domain/identity/email';
import { LoginFlow } from '../../../src/domain/identity/login-flow';
import { BusinessRuleViolation } from '../../../src/domain/shared-kernel/errors';

const email = Email.of('a@example.com');
const approval = DeviceApprovalRequest.of({ id: 'r1', secret: 's1', humanId: '1', createdAt: new Date(0) });

function expectViolation(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessRuleViolation);
    expect((error as BusinessRuleViolation).code).toBe(code);
    return;
  }
  throw new Error('expected a BusinessRuleViolation');
}

describe('LoginFlow', () => {
  it('starts idle', () => {
    const flow = LoginFlow.idle();
    expect(flow).toMatchObject({ stage: 'IDLE', email: null, verificationId: null, approval: null });
    expect(Object.isFrozen(flow)).toBe(true);
    expectViolation(() => flow.requireCodeSent(), 'LOGIN_NOT_STARTED');
    expectViolation(() => flow.requireAwaitingApproval(), 'NO_PENDING_APPROVAL');
  });

  it('IDLE → CODE_SENT → AWAITING_APPROVAL', () => {
    const sent = LoginFlow.idle().codeSent(email, 'v1');
    expect(sent.stage).toBe('CODE_SENT');
    expect(sent.requireCodeSent()).toEqual({ email, verificationId: 'v1' });
    expectViolation(() => sent.requireAwaitingApproval(), 'NO_PENDING_APPROVAL');

    const awaiting = sent.awaitingApproval(approval);
    expect(awaiting).toMatchObject({ stage: 'AWAITING_APPROVAL', email, verificationId: null, approval });
    expect(awaiting.requireAwaitingApproval()).toBe(approval);
    expectViolation(() => awaiting.requireCodeSent(), 'LOGIN_NOT_STARTED');
  });

  it('allows re-approval straight from IDLE', () => {
    const awaiting = LoginFlow.idle().awaitingApproval(approval);
    expect(awaiting.email).toBeNull();
    expect(awaiting.requireAwaitingApproval()).toBe(approval);
  });

  it('rejects CODE_SENT with an empty verification id', () => {
    expectViolation(() => LoginFlow.idle().codeSent(email, '').requireCodeSent(), 'LOGIN_NOT_STARTED');
    expectViolation(
      () =>
        LoginFlow.idle()
          .codeSent(null as unknown as Email, 'v1')
          .requireCodeSent(),
      'LOGIN_NOT_STARTED',
    );
  });

  it('rejects AWAITING_APPROVAL without a request', () => {
    const flow = LoginFlow.idle().awaitingApproval(null as unknown as DeviceApprovalRequest);
    expectViolation(() => flow.requireAwaitingApproval(), 'NO_PENDING_APPROVAL');
  });
});
