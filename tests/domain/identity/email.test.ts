import { describe, expect, it } from 'vitest';
import { Email } from '../../../src/domain/identity/email.js';
import { ValidationError } from '../../../src/domain/shared-kernel/errors.js';

describe('Email', () => {
  it('normalises case and whitespace', () => {
    const email = Email.of('  Ahmed@Example.COM ');
    expect(email.value).toBe('ahmed@example.com');
    expect(email.toString()).toBe('ahmed@example.com');
    expect(Object.isFrozen(email)).toBe(true);
  });

  it('masks the local part', () => {
    expect(Email.of('ahmed@example.com').masked()).toBe('a***@example.com');
  });

  it.each(['', 'no-at-sign', 'a@b', 'a b@c.com', '@example.com'])('rejects %j', (raw) => {
    expect(() => Email.of(raw)).toThrow(ValidationError);
  });

  it('rejects non-string input with a descriptive message', () => {
    expect(() => Email.of(42 as unknown as string)).toThrow('Invalid email address: "42"');
  });
});
