import type { Logger } from '../../application/ports/logger';
import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function parseLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? '').toLowerCase();
  return value in ORDER ? (value as LogLevel) : 'info';
}

/**
 * Writes JSON lines to stderr. stdout is reserved for the MCP stdio transport (ADR 0009).
 */
export class StderrLogger implements Logger {
  constructor(
    private readonly level: LogLevel = 'info',
    private readonly write: (line: string) => void = (line) => process.stderr.write(line),
    private readonly now: () => Date = () => new Date(),
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  private log(level: Exclude<LogLevel, 'silent'>, message: string, context?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const entry = {
      ts: this.now().toISOString(),
      level,
      msg: redact(message),
      ...(context ? { ctx: redact(context) } : {}),
    };
    this.write(`${JSON.stringify(entry)}\n`);
  }
}
