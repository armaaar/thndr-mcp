import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '../../../src/infrastructure/logging/redact';
import { parseLogLevel, StderrLogger } from '../../../src/infrastructure/logging/stderr-logger';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123';

describe('redact', () => {
  it('redacts sensitive keys deeply and JWT-looking strings', () => {
    const out = redact({
      authorization: 'Bearer x',
      nested: { refreshToken: 'r', list: [{ password: 'p' }, `token is ${JWT}`] },
      ok: 1,
      nil: null,
    });
    expect(out).toEqual({
      authorization: REDACTED,
      nested: { refreshToken: REDACTED, list: [{ password: REDACTED }, `token is ${REDACTED}`] },
      ok: 1,
      nil: null,
    });
  });

  it('handles errors and deep nesting', () => {
    expect(redact(new Error(`boom ${JWT}`))).toEqual({ name: 'Error', message: `boom ${REDACTED}` });
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { d: deep };
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
  });
});

describe('StderrLogger', () => {
  it('writes redacted JSON lines at or above level', () => {
    const lines: string[] = [];
    const logger = new StderrLogger(
      'info',
      (l) => lines.push(l),
      () => new Date('2026-01-01T00:00:00Z'),
    );
    logger.debug('hidden');
    logger.info('hello', { token: 'secret' });
    logger.warn('warn');
    logger.error(`err ${JWT}`);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toEqual({
      ts: '2026-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'hello',
      ctx: { token: REDACTED },
    });
    expect(lines[1]).not.toContain('ctx');
    expect(lines[2]).not.toContain(JWT);
  });

  it('debug level logs everything; silent logs nothing', () => {
    const lines: string[] = [];
    new StderrLogger('debug', (l) => lines.push(l)).debug('d');
    new StderrLogger('silent', (l) => lines.push(l)).error('e');
    expect(lines).toHaveLength(1);
  });

  it('defaults to stderr', () => {
    const logger = new StderrLogger('silent');
    expect(() => logger.info('x')).not.toThrow();
    const real = new StderrLogger('error');
    const orig = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string) => {
      captured.push(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      real.error('to-stderr');
    } finally {
      process.stderr.write = orig;
    }
    expect(captured[0]).toContain('to-stderr');
  });

  it('parses levels', () => {
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel('nope')).toBe('info');
    expect(parseLogLevel(undefined)).toBe('info');
  });
});
