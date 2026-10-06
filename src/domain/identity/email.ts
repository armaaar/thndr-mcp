import { ValidationError } from '../shared/errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Email {
    const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(normalized)) throw new ValidationError(`Invalid email address: "${raw}"`);
    return new Email(normalized);
  }

  /** `a***@example.com` — safe to show in tool output and logs. */
  masked(): string {
    const [local = '', domain = ''] = this.value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  toString(): string {
    return this.value;
  }
}
