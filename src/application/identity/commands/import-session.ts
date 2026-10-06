import { z } from 'zod';
import { AccessToken } from '../../../domain/identity/access-token';
import { RefreshCredential } from '../../../domain/identity/refresh-credential';
import { ThndrSession } from '../../../domain/identity/thndr-session';
import { assertNonEmpty } from '../../../domain/shared-kernel/guards';
import { Command, type InputOf } from '../../use-case';
import type { LoginDependencies } from '../dependencies';

const input = { cookieHeader: z.string().min(3).describe('Value of the Cookie header sent to x.thndr.app') };

type ImportSessionResult = { authenticated: true; accessTokenExpiresAt: string };

/** Fallback (ADR 0007): import an authenticated x.thndr.app browser session from its Cookie header. */
export class ImportSession extends Command<typeof input, ImportSessionResult> {
  readonly name = 'login_import_session';
  readonly title = 'Import browser session';
  readonly description =
    'Fallback login for accounts that use Google/Apple sign-in: the user logs in at https://x.thndr.app in a ' +
    'browser and pastes the Cookie request header of any x.thndr.app/api request (DevTools → Network).';
  readonly context = 'identity';
  readonly input = input;

  constructor(private readonly deps: Pick<LoginDependencies, 'gateway' | 'sessions' | 'clock'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<ImportSessionResult> {
    const refresh = RefreshCredential.fromCookieHeader(assertNonEmpty(params.cookieHeader, 'Cookie header'));
    const issued = await this.deps.gateway.refreshAccess(refresh);
    const merged = refresh.merge(issued.cookies, issued.refreshExpiresAt);
    const session = ThndrSession.establish(
      merged,
      AccessToken.of(issued.accessToken, issued.accessTokenExpiresAt),
      this.deps.clock.now(),
    );
    await this.deps.sessions.save(session);
    return { authenticated: true, accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString() };
  }
}
