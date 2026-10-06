import { ValidationError } from '../shared-kernel/errors';

export type TokenStatus = 'VALID' | 'ABOUT_TO_EXPIRE' | 'EXPIRED';

/** ThndrX refreshes the full-access token 3 minutes before expiry (docs/api/auth.md §2.4). */
export const ACCESS_TOKEN_REFRESH_WINDOW_MS = 180_000;
/** Lifetime assumed by ThndrX when the server does not tell us. */
export const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60_000;

/** The 15-minute full-access JWT used as `Authorization: Bearer`. */
export class AccessToken {
  private constructor(
    readonly value: string,
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
  }

  static of(value: string, expiresAt: Date): AccessToken {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Access token must not be empty');
    }
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError('Access token expiry must be a valid date');
    }
    return new AccessToken(value.trim(), new Date(expiresAt.getTime()));
  }

  /** Never serialise the secret (defence in depth against accidental logging). */
  toJSON(): string {
    return '[REDACTED AccessToken]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED AccessToken]';
  }

  status(now: Date): TokenStatus {
    const remaining = this.expiresAt.getTime() - now.getTime();
    if (remaining <= 0) return 'EXPIRED';
    if (remaining <= ACCESS_TOKEN_REFRESH_WINDOW_MS) return 'ABOUT_TO_EXPIRE';
    return 'VALID';
  }

  /** A token is usable for a request until it actually expires. */
  isUsable(now: Date): boolean {
    return this.status(now) !== 'EXPIRED';
  }
}
