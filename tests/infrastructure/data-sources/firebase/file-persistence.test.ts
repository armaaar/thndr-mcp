import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilePersistence } from '../../../../src/infrastructure/data-sources/firebase/file-persistence.js';
import { SessionFile } from '../../../../src/infrastructure/data-sources/local/session-file.js';

interface PersistenceInstance {
  type: string;
  _isAvailable(): Promise<boolean>;
  _set(key: string, value: unknown): Promise<void>;
  _get<T>(key: string): Promise<T | null>;
  _remove(key: string): Promise<void>;
  _addListener(key: string, listener: () => void): void;
  _removeListener(key: string, listener: () => void): void;
}

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thndr-mcp-fb-'));
  path = join(dir, 'session.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function instantiate(file: SessionFile) {
  const Persistence = createFilePersistence(file) as unknown as (new () => PersistenceInstance) & {
    type: string;
  };
  return { Persistence, instance: new Persistence() };
}

describe('createFilePersistence', () => {
  it('is a LOCAL persistence class that is always available', async () => {
    const { Persistence, instance } = instantiate(new SessionFile(path));
    expect(Persistence.type).toBe('LOCAL');
    expect(instance.type).toBe('LOCAL');
    await expect(instance._isAvailable()).resolves.toBe(true);
    expect(instance._addListener('k', () => undefined)).toBeUndefined();
    expect(instance._removeListener('k', () => undefined)).toBeUndefined();
  });

  it('stores, reads and removes entries in the session file', async () => {
    const { instance } = instantiate(new SessionFile(path));
    await expect(instance._get('user')).resolves.toBeNull();
    await instance._set('user', { uid: 'u1' });
    await expect(instance._get('user')).resolves.toEqual({ uid: 'u1' });
    expect(JSON.parse(await readFile(path, 'utf8')).firebase).toEqual({ user: { uid: 'u1' } });

    const reopened = instantiate(new SessionFile(path)).instance;
    await expect(reopened._get('user')).resolves.toEqual({ uid: 'u1' });

    await instance._remove('user');
    await expect(instance._get('user')).resolves.toBeNull();
    expect(JSON.parse(await readFile(path, 'utf8')).firebase).toEqual({});
  });

  it('returns falsy stored values as-is', async () => {
    const { instance } = instantiate(new SessionFile(path));
    await instance._set('flag', false);
    await expect(instance._get('flag')).resolves.toBe(false);
  });
});
