import { ValidationError } from '../shared-kernel/errors.js';

/**
 * The httpOnly refresh cookie(s) issued by `x.thndr.app/api/auth/login`. The cookie name is not visible to the
 * ThndrX JS, so we keep every cookie the server sets and replay them all (ADR 0007).
 */
export class RefreshCredential {
  private constructor(
    readonly cookies: Readonly<Record<string, string>>,
    readonly expiresAt: Date | null,
  ) {
    Object.freeze(this);
  }

  static of(cookies: Record<string, string>, expiresAt: Date | null = null): RefreshCredential {
    const entries = Object.entries(cookies ?? {}).filter(
      ([name, value]) => name.trim() && value !== undefined,
    );
    if (entries.length === 0) throw new ValidationError('Refresh credential needs at least one cookie');
    if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError('Refresh credential expiry must be a valid date');
    }
    return new RefreshCredential(Object.freeze(Object.fromEntries(entries)), expiresAt);
  }

  /** Never serialise the secret (defence in depth against accidental logging). */
  toJSON(): string {
    return '[REDACTED RefreshCredential]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED RefreshCredential]';
  }

  /** Parses a browser `Cookie` header (`a=1; b=2`). */
  static fromCookieHeader(header: string, expiresAt: Date | null = null): RefreshCredential {
    const cookies: Record<string, string> = {};
    for (const part of (header ?? '').split(';')) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return RefreshCredential.of(cookies, expiresAt);
  }

  /** Returns a new credential with `updates` merged in (rotated cookies win). */
  merge(updates: Record<string, string>, expiresAt: Date | null = this.expiresAt): RefreshCredential {
    return RefreshCredential.of({ ...this.cookies, ...updates }, expiresAt);
  }

  toCookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  isExpired(now: Date): boolean {
    return this.expiresAt !== null && this.expiresAt.getTime() <= now.getTime();
  }
}
