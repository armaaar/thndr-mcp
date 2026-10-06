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

  it('follows the system theme until the header button pins light or dark', () => {
    expect(page).toContain('<button class="theme" id="theme" type="button">');
    expect(page).toMatch(/:root \{ color-scheme: dark;/);
    expect(page).toMatch(/:root\[data-theme="light"\] \{ color-scheme: light;/);
    expect(page).toMatch(
      /@media \(prefers-color-scheme: light\) \{ :root:not\(\[data-theme="dark"\]\) \{ color-scheme: light;/,
    );
    expect(page).toContain("'Switch to light mode' : 'Switch to dark mode'");
  });

  it('strips whitespace pasted into the email and code fields', () => {
    expect(page).toContain("for (const id of ['email-input', 'code-input'])");
    expect(page).toContain(String.raw`const clean = input.value.replace(/\s+/g, '');`);
    expect(page).toContain("post('email', { email: $('email-input').value.trim() })");
    expect(page).toContain(String.raw`post('code', { code: $('code-input').value.replace(/\s+/g, '') })`);
  });

  it('adapts to phone screens', () => {
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain('@media (max-width: 520px)');
  });
});
