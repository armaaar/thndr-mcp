import { vi } from 'vitest';

/** A use-case double: `execute` is a spy returning `result`. Cast to the concrete class at the call site. */
export function stub<T>(result: unknown = { ok: true }): T & { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn(async () => result) } as unknown as T & { execute: ReturnType<typeof vi.fn> };
}
