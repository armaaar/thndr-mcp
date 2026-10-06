import type { Persistence } from '@firebase/auth';
import type { SessionFile } from '../persistence/session-file.js';

/**
 * Builds a Firebase Auth persistence class backed by our session file (ADR 0010).
 * Mirrors the contract of Firebase's built-in `inMemoryPersistence` (`_get/_set/_remove`), with type `LOCAL`
 * so the signed-in user survives process restarts.
 */
export function createFilePersistence(file: SessionFile): Persistence {
  class FilePersistence {
    static type = 'LOCAL' as const;
    readonly type = 'LOCAL' as const;

    async _isAvailable(): Promise<boolean> {
      return true;
    }

    async _set(key: string, value: unknown): Promise<void> {
      await file.update((content) => {
        content.firebase[key] = value;
      });
    }

    async _get<T>(key: string): Promise<T | null> {
      const value = (await file.read()).firebase[key];
      return value === undefined ? null : (value as T);
    }

    async _remove(key: string): Promise<void> {
      await file.update((content) => {
        delete content.firebase[key];
      });
    }

    _addListener(): void {}

    _removeListener(): void {}
  }
  return FilePersistence as unknown as Persistence;
}
