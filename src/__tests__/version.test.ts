import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../version';

describe('VERSION', () => {
  it('matches package.json, which release-please bumps together with it', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
