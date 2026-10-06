import type { AccessToken } from './access-token.js';
import type { RefreshCredential } from './refresh-credential.js';

/** An authenticated ThndrX session: a refresh credential plus (optionally) a cached access token. */
export class ThndrSession {
  private constructor(
    readonly refresh: RefreshCredential,
    readonly accessToken: AccessToken | null,
    readonly establishedAt: Date,
  ) {
    Object.freeze(this);
  }

  static establish(refresh: RefreshCredential, accessToken: AccessToken | null, now: Date): ThndrSession {
    return new ThndrSession(refresh, accessToken, now);
  }

  static restore(
    refresh: RefreshCredential,
    accessToken: AccessToken | null,
    establishedAt: Date,
  ): ThndrSession {
    return new ThndrSession(refresh, accessToken, establishedAt);
  }

  withAccessToken(token: AccessToken, refresh: RefreshCredential = this.refresh): ThndrSession {
    return new ThndrSession(refresh, token, this.establishedAt);
  }

  withoutAccessToken(): ThndrSession {
    return new ThndrSession(this.refresh, null, this.establishedAt);
  }

  /** The cached access token if it can be sent without refreshing first. */
  usableAccessToken(now: Date): AccessToken | null {
    return this.accessToken && this.accessToken.status(now) === 'VALID' ? this.accessToken : null;
  }
}
