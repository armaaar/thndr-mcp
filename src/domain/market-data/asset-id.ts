import { ValidationError } from '../shared-kernel/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thndr's instrument identifier (a UUID). */
export class AssetId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): AssetId {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!UUID.test(value)) throw new ValidationError(`Invalid asset id: "${raw}"`);
    return new AssetId(value);
  }

  static isAssetId(raw: string): boolean {
    return typeof raw === 'string' && UUID.test(raw.trim());
  }

  equals(other: AssetId): boolean {
    return other.value === this.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
