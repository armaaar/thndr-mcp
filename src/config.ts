import { type LogLevel, parseLogLevel } from './infrastructure/logging/stderr-logger.js';
import { defaultSessionPath } from './infrastructure/persistence/session-file.js';

/** Runtime configuration, read from environment variables (see README). */
export interface AppConfig {
  apiBaseUrl: string;
  webBaseUrl: string;
  runtimeVersion: string;
  language: 'ar' | 'en';
  sessionFile: string;
  logLevel: LogLevel;
  userAgent: string;
}

/** `x-thndrx-runtime-version` of the ThndrX build the adapters were verified against (`npm run sync:api`). */
export const THNDRX_RUNTIME_VERSION = '3.8.3';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    apiBaseUrl: env.THNDR_API_BASE_URL || 'https://prod.thndr.app',
    webBaseUrl: env.THNDR_WEB_BASE_URL || 'https://x.thndr.app/api',
    runtimeVersion: env.THNDR_RUNTIME_VERSION || THNDRX_RUNTIME_VERSION,
    language: env.THNDR_LANGUAGE === 'ar' ? 'ar' : 'en',
    sessionFile: defaultSessionPath(env),
    logLevel: parseLogLevel(env.THNDR_LOG_LEVEL),
    userAgent:
      env.THNDR_USER_AGENT ||
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 thndr-mcp',
  };
}
