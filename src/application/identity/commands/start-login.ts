import { z } from 'zod';
import { Email } from '../../../domain/identity/email';
import { Command, type InputOf } from '../../use-case';
import type { LoginDependencies } from '../dependencies';

const input = { email: z.string().describe('Email address registered with Thndr') };

/** Step 1: mail a 6-digit code to the user's Thndr email. */
export class StartLogin extends Command<typeof input, { maskedEmail: string; message: string }> {
  readonly name = 'login_start';
  readonly title = 'Start Thndr login';
  readonly description =
    'Step 1 of 3. Sends a 6-digit verification code to the email address of the Thndr account. ' +
    'Ask the user for their Thndr email if you do not know it. Next: login_verify_code.';
  readonly context = 'identity';
  readonly input = input;

  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'flow'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<{ maskedEmail: string; message: string }> {
    const email = Email.of(params.email);
    const verificationId = await this.deps.gateway.sendEmailCode(email.value);
    await this.deps.flow.save((await this.deps.flow.load()).codeSent(email, verificationId));
    return {
      maskedEmail: email.masked(),
      message: `A 6-digit verification code was sent to ${email.masked()}. Call login_verify_code with it.`,
    };
  }
}
