const SENSITIVE_KEY = /token|authorization|password|cookie|secret|refresh|credential|oob|apikey/i;
const JWT_LIKE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
export const REDACTED = '[REDACTED]';

/** Deep-copies `value`, replacing anything that looks like a credential. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[Truncated]';
  if (typeof value === 'string') return value.replace(JWT_LIKE, REDACTED);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
    }
    return result;
  }
  return value;
}
