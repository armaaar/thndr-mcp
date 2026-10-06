import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../shared-kernel/errors';
import { AssetId } from '../asset-id';

const ID = '1923d036-45ad-480b-8c6b-1d1296862f6e';

describe('AssetId', () => {
  it('normalises to trimmed lower case and is immutable', () => {
    const id = AssetId.of(`  ${ID.toUpperCase()} `);
    expect(id.value).toBe(ID);
    expect(id.toString()).toBe(ID);
    expect(id.toJSON()).toBe(ID);
    expect(JSON.stringify({ id })).toBe(`{"id":"${ID}"}`);
    expect(Object.isFrozen(id)).toBe(true);
  });

  it('compares by value', () => {
    expect(AssetId.of(ID).equals(AssetId.of(ID.toUpperCase()))).toBe(true);
    expect(AssetId.of(ID).equals(AssetId.of('00000000-0000-0000-0000-000000000000'))).toBe(false);
  });

  it('rejects non-UUIDs', () => {
    expect(() => AssetId.of('COMI')).toThrow(ValidationError);
    expect(() => AssetId.of('COMI')).toThrow('Invalid asset id: "COMI"');
    expect(() => AssetId.of(42 as unknown as string)).toThrow(ValidationError);
  });

  it('detects UUID-looking input', () => {
    expect(AssetId.isAssetId(` ${ID} `)).toBe(true);
    expect(AssetId.isAssetId(ID.toUpperCase())).toBe(true);
    expect(AssetId.isAssetId('COMI')).toBe(false);
    expect(AssetId.isAssetId(undefined as unknown as string)).toBe(false);
  });
});
