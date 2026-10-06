/** Truncates `value` to an integer within [min, max]; missing or non-finite values become `fallback`. */
export function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(Math.max(n, min), max);
}
