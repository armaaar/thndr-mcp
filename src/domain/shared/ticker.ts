import { ValidationError } from './errors.js';

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,14}$/;

/** Exchange ticker symbol such as `COMI` or `HRHO`. Case-insensitive on input, upper-case internally. */
export class Ticker {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Ticker {
    const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!TICKER_PATTERN.test(normalized)) throw new ValidationError(`Invalid ticker symbol: "${raw}"`);
    return new Ticker(normalized);
  }

  equals(other: Ticker): boolean {
    return other.value === this.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
