import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_REFRESH_WINDOW_MS,
  AccessToken,
  DEFAULT_ACCESS_TOKEN_TTL_MS,
} from '../../../src/domain/identity/access-token.js';
import { ValidationError } from '../../../src/domain/shared/errors.js';

const expiresAt = new Date('2026-01-01T00:15:00Z');

describe('AccessToken', () => {
  it('trims the value and copies the expiry', () => {
    const source = new Date(expiresAt.getTime());
    const token = AccessToken.of('  jwt  ', source);
    source.setTime(0);
    expect(token.value).toBe('jwt');
    expect(token.expiresAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(Object.isFrozen(token)).toBe(true);
  });

  it('exposes the ThndrX constants', () => {
    expect(ACCESS_TOKEN_REFRESH_WINDOW_MS).toBe(180_000);
    expect(DEFAULT_ACCESS_TOKEN_TTL_MS).toBe(900_000);
  });

  it.each(['', '   ', 5 as unknown as string])('rejects empty value %j', (value) => {
    expect(() => AccessToken.of(value, expiresAt)).toThrow('Access token must not be empty');
  });

  it('rejects invalid expiry dates', () => {
    expect(() => AccessToken.of('jwt', new Date('nope'))).toThrow(ValidationError);
    expect(() => AccessToken.of('jwt', '2026-01-01' as unknown as Date)).toThrow(
      'Access token expiry must be a valid date',
    );
  });

  it('computes status relative to the refresh window', () => {
    const token = AccessToken.of('jwt', expiresAt);
    const at = (ms: number) => new Date(expiresAt.getTime() - ms);
    expect(token.status(at(ACCESS_TOKEN_REFRESH_WINDOW_MS + 1))).toBe('VALID');
    expect(token.status(at(ACCESS_TOKEN_REFRESH_WINDOW_MS))).toBe('ABOUT_TO_EXPIRE');
    expect(token.status(at(1))).toBe('ABOUT_TO_EXPIRE');
    expect(token.status(at(0))).toBe('EXPIRED');
    expect(token.status(at(-1000))).toBe('EXPIRED');
  });

  it('is usable until it actually expires', () => {
    const token = AccessToken.of('jwt', expiresAt);
    expect(token.isUsable(new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(token.isUsable(expiresAt)).toBe(false);
  });
});
