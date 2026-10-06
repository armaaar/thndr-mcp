import { z } from 'zod';
import { LoginFlow } from '../../../domain/identity/login-flow';
import { Command, type InputOf } from '../../use-case';
import type { LoginDependencies } from '../dependencies';

const input = { forgetIdentity: z.boolean().default(false) };

export class Logout extends Command<typeof input, { loggedOut: true }> {
  readonly name = 'logout';
  readonly title = 'Log out of Thndr';
  readonly description =
    'Ends the Thndr session and deletes stored tokens. With forgetIdentity=true also signs out of Firebase.';
  readonly context = 'identity';
  readonly input = input;
  override readonly destructive = true;
  override readonly idempotent = true;

  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'identity' | 'sessions' | 'flow'>) {
    super();
  }

  async execute(params: InputOf<typeof input> = {}): Promise<{ loggedOut: true }> {
    const session = await this.deps.sessions.load();
    if (session) {
      // Best effort: the local session is discarded even if Thndr cannot be reached.
      await this.deps.gateway.logout(session.refresh).catch(() => undefined);
      await this.deps.sessions.clear();
    }
    if (params.forgetIdentity) await this.deps.identity.signOut();
    await this.deps.flow.save(LoginFlow.idle());
    return { loggedOut: true };
  }
}
