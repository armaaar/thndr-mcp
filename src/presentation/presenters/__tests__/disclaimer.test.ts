import { describe, expect, it } from 'vitest';
import { SHORT_DISCLAIMER, terminalDisclaimer } from '../disclaimer';

describe('terminalDisclaimer', () => {
  it('wraps the short disclaimer to the width and points to the full text', () => {
    const text = terminalDisclaimer(60);
    const lines = text.split('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    expect(text.replace(/\n/g, ' ')).toBe(`${SHORT_DISCLAIMER} Full text: DISCLAIMER.md.`);
    expect(
      terminalDisclaimer()
        .split('\n')
        .every((l) => l.length <= 100),
    ).toBe(true);
  });

  it('keeps a word longer than the width on its own line', () => {
    expect(terminalDisclaimer(5).split('\n')[0]).toBe('thndr-mcp');
  });
});
