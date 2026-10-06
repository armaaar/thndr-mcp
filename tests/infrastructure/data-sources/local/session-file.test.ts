import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultSessionPath,
  SessionFile,
} from '../../../../src/infrastructure/data-sources/local/session-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thndr-mcp-session-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe('defaultSessionPath', () => {
  it('prefers THNDR_SESSION_FILE', () => {
    expect(defaultSessionPath({ THNDR_SESSION_FILE: '/x/s.json', XDG_CONFIG_HOME: '/cfg' })).toBe(
      '/x/s.json',
    );
  });

  it('uses XDG_CONFIG_HOME, then ~/.config', () => {
    expect(defaultSessionPath({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/thndr-mcp/session.json');
    expect(defaultSessionPath({ XDG_CONFIG_HOME: '' })).toBe(
      join(homedir(), '.config', 'thndr-mcp', 'session.json'),
    );
  });

  it('defaults to process.env', () => {
    expect(defaultSessionPath()).toBe(defaultSessionPath(process.env));
  });
});

describe('SessionFile', () => {
  it('reads an empty document when the file does not exist', async () => {
    const file = new SessionFile(join(dir, 'missing.json'));
    expect(file.path).toBe(join(dir, 'missing.json'));
    await expect(file.read()).resolves.toEqual({ version: 1, firebase: {}, thndr: null, loginFlow: null });
  });

  it('writes atomically with 0600 in a freshly created 0700 directory', async () => {
    const path = join(dir, 'nested', 'deeper', 'session.json');
    const file = new SessionFile(path);
    await file.update((content) => {
      content.firebase.k = { v: 1 };
    });
    expect(await mode(path)).toBe(0o600);
    expect(await mode(join(dir, 'nested', 'deeper'))).toBe(0o700);
    expect(await mode(join(dir, 'nested'))).toBe(0o700);
    const raw = await readFile(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ version: 1, firebase: { k: { v: 1 } }, thndr: null, loginFlow: null });
    await expect(stat(`${path}.${process.pid}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('tightens permissions of an existing world-readable file', async () => {
    const path = join(dir, 'session.json');
    await writeFile(path, JSON.stringify({ version: 1, firebase: {}, thndr: null, loginFlow: null }), {
      mode: 0o644,
    });
    await new SessionFile(path).update(() => undefined);
    expect(await mode(path)).toBe(0o600);
  });

  it('loads existing content and normalises missing or invalid sections', async () => {
    const path = join(dir, 'session.json');
    const thndr = {
      cookies: { a: '1' },
      refreshExpiresAt: null,
      accessToken: null,
      accessTokenExpiresAt: null,
      establishedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeFile(path, JSON.stringify({ firebase: 'bad', thndr }));
    await expect(new SessionFile(path).read()).resolves.toEqual({
      version: 1,
      firebase: {},
      thndr,
      loginFlow: null,
    });
    await writeFile(path, JSON.stringify({ firebase: { x: 1 } }));
    await expect(new SessionFile(path).read()).resolves.toEqual({
      version: 1,
      firebase: { x: 1 },
      thndr: null,
      loginFlow: null,
    });
  });

  it.each(['{not json', 'null', ''])('treats corrupted content %j as empty', async (raw) => {
    const path = join(dir, 'session.json');
    await writeFile(path, raw);
    await expect(new SessionFile(path).read()).resolves.toEqual({
      version: 1,
      firebase: {},
      thndr: null,
      loginFlow: null,
    });
  });

  it('propagates other read errors (EISDIR)', async () => {
    const path = join(dir, 'a-directory');
    await mkdir(path);
    await expect(new SessionFile(path).read()).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it("always reads from disk so other processes see each other's writes", async () => {
    const path = join(dir, 'session.json');
    const file = new SessionFile(path);
    await file.update((content) => {
      content.firebase.mine = 1;
    });
    // Another process (e.g. the CLI while the MCP server runs) rewrites the file.
    await writeFile(path, JSON.stringify({ firebase: { external: true } }));
    expect((await file.read()).firebase).toEqual({ external: true });
    await file.update((content) => {
      content.firebase.mine = 2;
    });
    expect((await file.read()).firebase).toEqual({ external: true, mine: 2 });
  });

  it('serialises concurrent updates', async () => {
    const path = join(dir, 'session.json');
    const file = new SessionFile(path);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        file.update((content) => {
          content.firebase[`k${i}`] = i;
        }),
      ),
    );
    const onDisk = JSON.parse(await readFile(path, 'utf8'));
    expect(onDisk.firebase).toEqual({ k0: 0, k1: 1, k2: 2, k3: 3, k4: 4 });
  });

  it('rejects a failed update without blocking later ones', async () => {
    const path = join(dir, 'session.json');
    const file = new SessionFile(path);
    const failing = file.update(() => {
      throw new Error('mutation failed');
    });
    const next = file.update((content) => {
      content.firebase.ok = true;
    });
    await expect(failing).rejects.toThrow('mutation failed');
    await expect(next).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path, 'utf8')).firebase).toEqual({ ok: true });
  });
});
