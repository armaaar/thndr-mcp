import { describe, expect, it } from 'vitest';
import { Ticker } from '../ticker';

describe('Ticker', () => {
  it('normalises to upper case', () => {
    const t = Ticker.of('  comi ');
    expect(t.value).toBe('COMI');
    expect(t.toString()).toBe('COMI');
    expect(t.toJSON()).toBe('COMI');
    expect(t.equals(Ticker.of('COMI'))).toBe(true);
    expect(t.equals(Ticker.of('HRHO'))).toBe(false);
  });

  it.each(['', '   ', '-ABC', 'A B', 'ÄBC', 'X'.repeat(16)])('rejects %j', (raw) => {
    expect(() => Ticker.of(raw)).toThrow(/Invalid ticker/);
  });

  it('rejects non-strings', () => {
    expect(() => Ticker.of(undefined as unknown as string)).toThrow(/Invalid ticker/);
  });
});
