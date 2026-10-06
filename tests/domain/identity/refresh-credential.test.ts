import { describe, expect, it } from 'vitest';
import { RefreshCredential } from '../../../src/domain/identity/refresh-credential.js';
import { ValidationError } from '../../../src/domain/shared-kernel/errors.js';

const expiry = new Date('2026-01-01T06:00:00Z');

describe('RefreshCredential', () => {
  it('keeps every named cookie and defaults expiry to null', () => {
    const credential = RefreshCredential.of({ a: '1', b: '' });
    expect(credential.cookies).toEqual({ a: '1', b: '' });
    expect(credential.expiresAt).toBeNull();
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.isFrozen(credential.cookies)).toBe(true);
  });

  it('drops blank names and undefined values', () => {
    const credential = RefreshCredential.of({ ' ': 'x', a: '1', b: undefined as unknown as string });
    expect(credential.cookies).toEqual({ a: '1' });
  });

  it('requires at least one cookie', () => {
    expect(() => RefreshCredential.of({})).toThrow('Refresh credential needs at least one cookie');
    expect(() => RefreshCredential.of(null as unknown as Record<string, string>)).toThrow(ValidationError);
  });

  it('rejects an invalid expiry', () => {
    expect(() => RefreshCredential.of({ a: '1' }, new Date('bad'))).toThrow(
      'Refresh credential expiry must be a valid date',
    );
  });

  it('parses a Cookie header, skipping malformed parts', () => {
    const credential = RefreshCredential.fromCookieHeader(' a=1; =x; junk; b = two=2 ;', expiry);
    expect(credential.cookies).toEqual({ a: '1', b: 'two=2' });
    expect(credential.expiresAt).toBe(expiry);
    expect(credential.toCookieHeader()).toBe('a=1; b=two=2');
  });

  it('rejects an empty or missing Cookie header', () => {
    expect(() => RefreshCredential.fromCookieHeader('')).toThrow(ValidationError);
    expect(() => RefreshCredential.fromCookieHeader(undefined as unknown as string)).toThrow(ValidationError);
  });

  it('merges rotated cookies, keeping the expiry unless overridden', () => {
    const base = RefreshCredential.of({ a: '1', b: '2' }, expiry);
    const merged = base.merge({ b: '3', c: '4' });
    expect(merged.cookies).toEqual({ a: '1', b: '3', c: '4' });
    expect(merged.expiresAt).toBe(expiry);
    expect(base.cookies).toEqual({ a: '1', b: '2' });
    const later = new Date('2026-01-02T00:00:00Z');
    expect(base.merge({}, later).expiresAt).toBe(later);
    expect(base.merge({}, null).expiresAt).toBeNull();
  });

  it('reports expiry only when a date is known', () => {
    expect(RefreshCredential.of({ a: '1' }).isExpired(new Date('2100-01-01'))).toBe(false);
    const credential = RefreshCredential.of({ a: '1' }, expiry);
    expect(credential.isExpired(new Date(expiry.getTime() - 1))).toBe(false);
    expect(credential.isExpired(expiry)).toBe(true);
  });
});

describe('RefreshCredential serialisation', () => {
  it('never exposes cookies via JSON or util.inspect', async () => {
    const { inspect } = await import('node:util');
    const { RefreshCredential: Credential } = await import(
      '../../../src/domain/identity/refresh-credential.js'
    );
    const credential = Credential.of({ rt: 'secret' });
    expect(JSON.stringify(credential)).toBe('"[REDACTED RefreshCredential]"');
    expect(inspect(credential)).toBe('[REDACTED RefreshCredential]');
  });
});
