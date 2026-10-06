import { describe, expect, it } from 'vitest';
import { renderLoginPage } from '../login-page';

describe('renderLoginPage', () => {
  const page = renderLoginPage('abc123');

  it('runs only the nonce-tagged inline script and loads nothing but the DM Sans stylesheet', () => {
    expect(page).toContain('<script nonce="abc123">');
    expect(page.match(/<script/g)).toHaveLength(1);
    expect([...page.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => new URL(m[1] ?? '').host)).toEqual(
      ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.googleapis.com'],
    );
  });

  it('labels itself as the unofficial thndr-mcp, not as Thndr', () => {
    expect(page).toContain('<title>thndr-mcp · Log in to Thndr</title>');
    expect(page).toContain('Unofficial community tool · not affiliated with Thndr');
  });

  it('keeps the escapes of its script regular expressions (it lives in a template literal)', () => {
    expect(page).toContain(String.raw`.replace(/^✔\s*/, '')`);
    expect(page).toContain(String.raw`/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g`);
  });

  it('labels every input and announces approval progress', () => {
    expect(page).toContain('<label for="email-input">');
    expect(page).toContain('<label for="code-input">');
    expect(page).toContain('id="approval-status" aria-live="polite"');
    expect(page).toContain('prefers-reduced-motion');
  });
});
