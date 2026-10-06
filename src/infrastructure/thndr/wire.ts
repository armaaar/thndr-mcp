/** Helpers for decoding loosely-typed Thndr payloads (anti-corruption layer). */

/** Decodes a JWT payload without verifying it (we only read `exp`). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return decoded !== null && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parses timestamps that may be epoch seconds, epoch milliseconds, numeric strings or ISO-8601 strings.
 */
export function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string') {
    if (/^\d+(\.\d+)?$/.test(value)) return parseTimestamp(Number(value));
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Converts numeric strings/numbers to numbers; anything else to `null`. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replaceAll(',', ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  expiresAt: Date | null;
  deleted: boolean;
}

/** Parses one `Set-Cookie` header value. */
export function parseSetCookie(header: string, now: Date): ParsedSetCookie | null {
  const [pair = '', ...attributes] = header.split(';');
  const index = pair.indexOf('=');
  if (index <= 0) return null;
  const name = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  let expiresAt: Date | null = null;
  let deleted = value === '';
  for (const attribute of attributes) {
    const [rawKey = '', ...rest] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    const attrValue = rest.join('=').trim();
    if (key === 'max-age') {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        expiresAt = new Date(now.getTime() + seconds * 1000);
        if (seconds <= 0) deleted = true;
      }
    } else if (key === 'expires' && expiresAt === null) {
      const date = new Date(attrValue);
      if (!Number.isNaN(date.getTime())) {
        expiresAt = date;
        if (date.getTime() <= now.getTime()) deleted = true;
      }
    }
  }
  return { name, value, expiresAt, deleted };
}
