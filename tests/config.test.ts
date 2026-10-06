import { describe, expect, it } from 'vitest';
import { loadConfig, THNDRX_RUNTIME_VERSION } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    const c = loadConfig({ HOME: '/home/u' });
    expect(c).toMatchObject({
      apiBaseUrl: 'https://prod.thndr.app',
      webBaseUrl: 'https://x.thndr.app/api',
      runtimeVersion: THNDRX_RUNTIME_VERSION,
      language: 'en',
      logLevel: 'info',
    });
    expect(c.sessionFile).toMatch(/thndr-mcp[/\\]session\.json$/);
    expect(c.userAgent).toContain('thndr-mcp');
  });

  it('honours overrides', () => {
    const c = loadConfig({
      THNDR_API_BASE_URL: 'https://a',
      THNDR_WEB_BASE_URL: 'https://b',
      THNDR_RUNTIME_VERSION: '9.9.9',
      THNDR_LANGUAGE: 'ar',
      THNDR_SESSION_FILE: '/tmp/s.json',
      THNDR_LOG_LEVEL: 'debug',
      THNDR_USER_AGENT: 'ua',
    });
    expect(c).toEqual({
      apiBaseUrl: 'https://a',
      webBaseUrl: 'https://b',
      runtimeVersion: '9.9.9',
      language: 'ar',
      sessionFile: '/tmp/s.json',
      logLevel: 'debug',
      userAgent: 'ua',
    });
  });
});
