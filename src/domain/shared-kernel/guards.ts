import { ValidationError } from './errors.js';

export function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`);
  }
}

export function assertPositive(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value <= 0) throw new ValidationError(`${label} must be greater than zero`);
}

export function assertPositiveInteger(value: number, label: string): void {
  assertPositive(value, label);
  if (!Number.isInteger(value)) throw new ValidationError(`${label} must be a whole number`);
}

export function assertNonEmpty(value: string, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) throw new ValidationError(`${label} must not be empty`);
  return trimmed;
}

/** Rounds to a fixed number of decimals, avoiding binary floating point artefacts (0.1 + 0.2). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
