import { describe, expect, it } from 'vitest';
import { approvalRequest, DEVICE_NAME, loginDeps } from '../../../../__tests__/support/identity-fakes';
import { Email } from '../../../../domain/identity/email';
import { BusinessRuleViolation, ValidationError } from '../../../../domain/shared-kernel/errors';
import { InvalidInputError } from '../../../use-case';
import { VerifyLoginCode } from '../verify-login-code';

function codeSent() {
  const d = loginDeps();
  void d.flow.save(d.flow.current.codeSent(Email.of('a@example.com'), 'verification-1'));
  return d;
}

describe('VerifyLoginCode', () => {
  it('declares its contract', () => {
    const uc = new VerifyLoginCode(loginDeps());
    expect(uc).toMatchObject({
      name: 'login_verify_code',
      kind: 'command',
      context: 'identity',
      destructive: false,
      idempotent: false,
    });
    expect(Object.keys(uc.input)).toEqual(['code']);
  });

  it('verifies the code, signs in to Firebase and requests approval', async () => {
    const d = codeSent();
    const result = await new VerifyLoginCode(d).execute({ code: ' 123 456 ' });
    expect(d.gateway.verifyEmailCode).toHaveBeenCalledWith('verification-1', '123456');
    expect(d.identity.signInWithCustomToken).toHaveBeenCalledWith('custom-token');
    expect(d.gateway.createApprovalRequest).toHaveBeenCalledWith('id-token');
    expect(result).toEqual({
      humanId: '4242',
      requestId: 'req-1',
      deepLink: approvalRequest.deepLink(DEVICE_NAME),
      message:
        'Approve the new login in the Thndr app on your phone (request 4242): scan the QR code of the deep link with the ' +
        'phone camera or the Thndr app, or open the deep link on the phone. Thndr sends no notification for it. ' +
        'Then call login_complete.',
    });
    expect(d.flow.current.stage).toBe('AWAITING_APPROVAL');
    expect(d.flow.current.email?.value).toBe('a@example.com');
  });

  it.each(['', '   ', '12a456', '123', '123456789'])('rejects code %j', async (code) => {
    const d = codeSent();
    await expect(new VerifyLoginCode(d).execute({ code })).rejects.toBeInstanceOf(ValidationError);
    expect(d.gateway.verifyEmailCode).not.toHaveBeenCalled();
  });

  it('requires login_start first', async () => {
    const d = loginDeps();
    await expect(new VerifyLoginCode(d).execute({ code: '123456' })).rejects.toBeInstanceOf(
      BusinessRuleViolation,
    );
  });

  it('validates input in run()', async () => {
    const d = codeSent();
    const uc = new VerifyLoginCode(d);
    await expect(uc.run({ code: 123456 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ code: '123456', email: 'x' })).rejects.toBeInstanceOf(InvalidInputError);
    expect(d.gateway.verifyEmailCode).not.toHaveBeenCalled();
    await expect(uc.run({ code: '123456' })).resolves.toMatchObject({ requestId: 'req-1' });
  });
});
