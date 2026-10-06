import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  parseSetCookie,
  parseTimestamp,
  toNumber,
  toStringOrNull,
} from '../../../../src/infrastructure/data-sources/thndr/wire';

const now = new Date('2026-01-01T00:00:00Z');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('decodeJwtPayload', () => {
  it('decodes the payload segment', () => {
    expect(decodeJwtPayload(`h.${b64({ exp: 1767225600, sub: 'u' })}.sig`)).toEqual({
      exp: 1767225600,
      sub: 'u',
    });
  });

  it.each([
    ['no payload segment', 'opaque'],
    ['empty payload', 'h..s'],
    ['invalid JSON', `h.${Buffer.from('{nope').toString('base64url')}.s`],
    ['non-object JSON', `h.${b64(42)}.s`],
    ['null JSON', `h.${b64(null)}.s`],
  ])('returns null for %s', (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it.each([
    [1767225600, '2026-01-01T00:00:00.000Z'],
    [1767225600000, '2026-01-01T00:00:00.000Z'],
    ['1767225600', '2026-01-01T00:00:00.000Z'],
    ['1767225600.5', '2026-01-01T00:00:00.500Z'],
    ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z'],
  ])('parses %j', (input, expected) => {
    expect(parseTimestamp(input)?.toISOString()).toBe(expected);
  });

  it.each([null, undefined, '', 'not a date', Number.NaN, Number.POSITIVE_INFINITY, {}, true])(
    'returns null for %j',
    (input) => {
      expect(parseTimestamp(input)).toBeNull();
    },
  );
});

describe('toNumber', () => {
  it.each([
    [5, 5],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['1,234.5', 1234.5],
    [' 7 ', 7],
    ['', null],
    ['   ', null],
    ['abc', null],
    [null, null],
    [true, null],
  ])('%j → %j', (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });
});

describe('toStringOrNull', () => {
  it.each([
    ['a', 'a'],
    [3, '3'],
    [false, 'false'],
    [null, null],
    [undefined, null],
    [{}, null],
  ])('%j → %j', (input, expected) => {
    expect(toStringOrNull(input)).toBe(expected);
  });
});

describe('parseSetCookie', () => {
  it('parses name, value and Max-Age', () => {
    expect(parseSetCookie('sid=abc=def; Path=/; HttpOnly; Max-Age=60', now)).toEqual({
      name: 'sid',
      value: 'abc=def',
      expiresAt: new Date('2026-01-01T00:01:00Z'),
      deleted: false,
    });
  });

  it('parses Expires and lets Max-Age take precedence', () => {
    expect(parseSetCookie('a=1; Expires=Thu, 01 Jan 2026 06:00:00 GMT', now)?.expiresAt).toEqual(
      new Date('2026-01-01T06:00:00Z'),
    );
    expect(parseSetCookie('a=1; Max-Age=60; Expires=Thu, 01 Jan 2026 06:00:00 GMT', now)?.expiresAt).toEqual(
      new Date('2026-01-01T00:01:00Z'),
    );
    expect(parseSetCookie('a=1; Expires=Thu, 01 Jan 2026 06:00:00 GMT; Max-Age=60', now)?.expiresAt).toEqual(
      new Date('2026-01-01T00:01:00Z'),
    );
  });

  it('ignores invalid Max-Age / Expires values', () => {
    expect(parseSetCookie('a=1; Max-Age=soon; Expires=garbage', now)).toEqual({
      name: 'a',
      value: '1',
      expiresAt: null,
      deleted: false,
    });
  });

  it.each([
    ['empty value', 'a=; Path=/'],
    ['Max-Age=0', 'a=1; Max-Age=0'],
    ['negative Max-Age', 'a=1; max-age=-1'],
    ['past Expires', 'a=1; expires=Thu, 01 Jan 1970 00:00:00 GMT'],
    ['Expires = now', 'a=1; Expires=Thu, 01 Jan 2026 00:00:00 GMT'],
  ])('marks %s as deleted', (_label, header) => {
    expect(parseSetCookie(header, now)?.deleted).toBe(true);
  });

  it.each(['', 'novalue', '=x'])('returns null for %j', (header) => {
    expect(parseSetCookie(header, now)).toBeNull();
  });
});
