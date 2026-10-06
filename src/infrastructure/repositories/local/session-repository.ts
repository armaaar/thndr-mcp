import { AccessToken } from '../../../domain/identity/access-token.js';
import { RefreshCredential } from '../../../domain/identity/refresh-credential.js';
import type { SessionRepository } from '../../../domain/identity/repository.js';
import { ThndrSession } from '../../../domain/identity/thndr-session.js';
import type { SessionFile, ThndrSessionRecord } from '../../data-sources/local/session-file.js';

export class FileSessionRepository implements SessionRepository {
  constructor(private readonly file: SessionFile) {}

  async load(): Promise<ThndrSession | null> {
    const record = (await this.file.read()).thndr;
    if (!record) return null;
    try {
      const refresh = RefreshCredential.of(
        record.cookies,
        record.refreshExpiresAt ? new Date(record.refreshExpiresAt) : null,
      );
      const token =
        record.accessToken && record.accessTokenExpiresAt
          ? AccessToken.of(record.accessToken, new Date(record.accessTokenExpiresAt))
          : null;
      return ThndrSession.restore(refresh, token, new Date(record.establishedAt));
    } catch {
      return null;
    }
  }

  async save(session: ThndrSession): Promise<void> {
    const record: ThndrSessionRecord = {
      cookies: { ...session.refresh.cookies },
      refreshExpiresAt: session.refresh.expiresAt?.toISOString() ?? null,
      accessToken: session.accessToken?.value ?? null,
      accessTokenExpiresAt: session.accessToken?.expiresAt.toISOString() ?? null,
      establishedAt: session.establishedAt.toISOString(),
    };
    await this.file.update((content) => {
      content.thndr = record;
    });
  }

  async clear(): Promise<void> {
    await this.file.update((content) => {
      content.thndr = null;
    });
  }
}
