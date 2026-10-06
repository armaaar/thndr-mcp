import { Query } from '../../use-case';
import type { LoginDependencies } from '../dependencies';

const input = {};

export interface AuthStatus {
  authenticated: boolean;
  identified: boolean;
  pendingStep: 'none' | 'verify_code' | 'approve_on_phone';
  accessTokenExpiresAt: string | null;
  sessionExpiresAt: string | null;
  sessionEstablishedAt: string | null;
}

export class GetAuthStatus extends Query<typeof input, AuthStatus> {
  readonly name = 'auth_status';
  readonly title = 'Thndr session status';
  readonly description =
    'Shows whether the server is logged in to Thndr, when the session expires, and which login step is pending. ' +
    'Call this first if another tool returns NOT_AUTHENTICATED or SESSION_EXPIRED.';
  readonly context = 'identity';
  readonly input = input;
  override readonly local = true;

  constructor(private readonly deps: Pick<LoginDependencies, 'identity' | 'sessions' | 'flow' | 'clock'>) {
    super();
  }

  async execute(): Promise<AuthStatus> {
    const [session, idToken] = await Promise.all([
      this.deps.sessions.load(),
      this.deps.identity.getIdToken().catch(() => null),
    ]);
    const stage = (await this.deps.flow.load()).stage;
    const now = this.deps.clock.now();
    return {
      authenticated: session !== null && !session.refresh.isExpired(now),
      identified: idToken !== null,
      pendingStep:
        stage === 'CODE_SENT' ? 'verify_code' : stage === 'AWAITING_APPROVAL' ? 'approve_on_phone' : 'none',
      accessTokenExpiresAt: session?.accessToken?.expiresAt.toISOString() ?? null,
      sessionExpiresAt: session?.refresh.expiresAt?.toISOString() ?? null,
      sessionEstablishedAt: session?.establishedAt.toISOString() ?? null,
    };
  }
}
