import { describe, expect, it } from 'vitest';
import { BusinessRuleViolation, ValidationError } from '../../../src/domain/shared-kernel/errors';
import {
  assertFiniteNumber,
  assertNonEmpty,
  assertPositive,
  assertPositiveInteger,
  roundTo,
} from '../../../src/domain/shared-kernel/guards';

describe('guards', () => {
  it('assertFiniteNumber', () => {
    expect(() => assertFiniteNumber(1, 'x')).not.toThrow();
    expect(() => assertFiniteNumber('1' as unknown as number, 'x')).toThrow('x must be a finite number');
  });

  it('assertPositive', () => {
    expect(() => assertPositive(0.01, 'x')).not.toThrow();
    expect(() => assertPositive(0, 'x')).toThrow('greater than zero');
  });

  it('assertPositiveInteger', () => {
    expect(() => assertPositiveInteger(3, 'q')).not.toThrow();
    expect(() => assertPositiveInteger(1.5, 'q')).toThrow('whole number');
  });

  it('assertNonEmpty trims', () => {
    expect(assertNonEmpty('  a ', 'n')).toBe('a');
    expect(() => assertNonEmpty('  ', 'n')).toThrow(ValidationError);
    expect(() => assertNonEmpty(undefined as unknown as string, 'n')).toThrow(ValidationError);
  });

  it('roundTo', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(12.3456, 3)).toBe(12.346);
  });
});

describe('errors', () => {
  it('carry codes and names', () => {
    const v = new ValidationError('bad');
    expect(v.code).toBe('VALIDATION_ERROR');
    expect(v.name).toBe('ValidationError');
    const b = new BusinessRuleViolation('MARKET_CLOSED', 'closed');
    expect(b.code).toBe('MARKET_CLOSED');
    expect(b.message).toBe('closed');
    expect(b).toBeInstanceOf(Error);
  });
});
