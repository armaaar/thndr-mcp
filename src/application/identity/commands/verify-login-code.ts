import { z } from 'zod';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { Command, type InputOf } from '../../use-case';
import type { ApprovalInstructions } from '../approval-instructions';
import type { LoginDependencies } from '../dependencies';
import { DeviceApprovalRequester } from '../services/device-approval-requester';

const input = { code: z.string().describe('The 6-digit code from the email') };

/** Step 2: verify the code, sign in to Firebase and create the device-approval request. */
export class VerifyLoginCode extends Command<typeof input, ApprovalInstructions> {
  readonly name = 'login_verify_code';
  readonly title = 'Verify Thndr email code';
  readonly description =
    'Step 2 of 3. Verifies the emailed code and creates a login request that the user must approve in the ' +
    'Thndr mobile app. Show the user the returned message (and deep link). Next: login_complete.';
  readonly context = 'identity';
  readonly input = input;

  constructor(
    private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'flow' | 'deviceName'>,
  ) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<ApprovalInstructions> {
    const code = assertNonEmpty(params.code, 'Verification code').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(code)) throw new ValidationError('Verification code must be 4–8 digits');
    const { verificationId } = (await this.deps.flow.load()).requireCodeSent();
    const customToken = await this.deps.gateway.verifyEmailCode(verificationId, code);
    await this.deps.identity.signInWithCustomToken(customToken);
    return new DeviceApprovalRequester(this.deps).request();
  }
}
