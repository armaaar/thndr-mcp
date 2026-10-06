import { describe, expect, it } from 'vitest';
import { StartLogin } from '../../../../src/application/identity/commands/start-login';
import { InvalidInputError } from '../../../../src/application/use-case';
import { Email } from '../../../../src/domain/identity/email';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { loginDeps } from '../../../support/identity-fakes';

describe('StartLogin', () => {
  it('declares its contract', () => {
    const uc = new StartLogin(loginDeps());
    expect(uc).toMatchObject({
      name: 'login_start',
      kind: 'command',
      context: 'identity',
      title: 'Start Thndr login',
      destructive: false,
      idempotent: false,
      local: false,
    });
    expect(Object.keys(uc.input)).toEqual(['email']);
  });

  it('mails the code and moves to CODE_SENT', async () => {
    const d = loginDeps();
    const result = await new StartLogin(d).execute({ email: ' Ahmed@Example.com ' });
    expect(d.gateway.sendEmailCode).toHaveBeenCalledWith('ahmed@example.com');
    expect(result.maskedEmail).toBe('a***@example.com');
    expect(result.message).toContain('a***@example.com');
    expect(result.message).toContain('login_verify_code');
    expect(d.flow.current.requireCodeSent()).toEqual({
      email: Email.of('ahmed@example.com'),
      verificationId: 'verification-1',
    });
  });

  it('rejects invalid emails before calling Thndr', async () => {
    const d = loginDeps();
    await expect(new StartLogin(d).execute({ email: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    expect(d.gateway.sendEmailCode).not.toHaveBeenCalled();
  });

  it('validates input in run()', async () => {
    const d = loginDeps();
    const uc = new StartLogin(d);
    await expect(uc.run({ email: 42 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({})).rejects.toBeInstanceOf(InvalidInputError);
    await expect(uc.run({ email: 'a@example.com', extra: 1 })).rejects.toBeInstanceOf(InvalidInputError);
    expect(d.gateway.sendEmailCode).not.toHaveBeenCalled();
    await expect(uc.run({ email: 'a@example.com' })).resolves.toMatchObject({
      maskedEmail: 'a***@example.com',
    });
  });
});
