import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessToken } from '../../../src/domain/identity/access-token.js';
import { RefreshCredential } from '../../../src/domain/identity/refresh-credential.js';
import { ThndrSession } from '../../../src/domain/identity/thndr-session.js';
import { FileSessionRepository } from '../../../src/infrastructure/persistence/file-session-repository.js';
import { SessionFile } from '../../../src/infrastructure/persistence/session-file.js';

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thndr-mcp-repo-'));
  path = join(dir, 'session.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const established = new Date('2026-01-01T00:00:00Z');

describe('FileSessionRepository', () => {
  it('returns null when nothing is stored', async () => {
    await expect(new FileSessionRepository(new SessionFile(path)).load()).resolves.toBeNull();
  });

  it('round-trips a full session through the file', async () => {
    const session = ThndrSession.establish(
      RefreshCredential.of({ sid: 'r1', b: '2' }, new Date('2026-01-01T06:00:00Z')),
      AccessToken.of('tok', new Date('2026-01-01T00:15:00Z')),
      established,
    );
    await new FileSessionRepository(new SessionFile(path)).save(session);
    expect(JSON.parse(await readFile(path, 'utf8')).thndr).toEqual({
      cookies: { sid: 'r1', b: '2' },
      refreshExpiresAt: '2026-01-01T06:00:00.000Z',
      accessToken: 'tok',
      accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
      establishedAt: '2026-01-01T00:00:00.000Z',
    });
    const loaded = await new FileSessionRepository(new SessionFile(path)).load();
    expect(loaded?.refresh.cookies).toEqual({ sid: 'r1', b: '2' });
    expect(loaded?.refresh.expiresAt).toEqual(new Date('2026-01-01T06:00:00Z'));
    expect(loaded?.accessToken?.value).toBe('tok');
    expect(loaded?.accessToken?.expiresAt).toEqual(new Date('2026-01-01T00:15:00Z'));
    expect(loaded?.establishedAt).toEqual(established);
  });

  it('round-trips a minimal session (no token, no expiry)', async () => {
    const repo = new FileSessionRepository(new SessionFile(path));
    await repo.save(ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }), null, established));
    expect(JSON.parse(await readFile(path, 'utf8')).thndr).toMatchObject({
      refreshExpiresAt: null,
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    const loaded = await new FileSessionRepository(new SessionFile(path)).load();
    expect(loaded?.accessToken).toBeNull();
    expect(loaded?.refresh.expiresAt).toBeNull();
  });

  it('ignores an access token without an expiry', async () => {
    await writeFile(
      path,
      JSON.stringify({
        thndr: {
          cookies: { a: '1' },
          accessToken: 'tok',
          accessTokenExpiresAt: null,
          establishedAt: established,
        },
      }),
    );
    const loaded = await new FileSessionRepository(new SessionFile(path)).load();
    expect(loaded?.accessToken).toBeNull();
  });

  it('returns null for an invalid stored record', async () => {
    await writeFile(path, JSON.stringify({ thndr: { cookies: {}, establishedAt: established } }));
    await expect(new FileSessionRepository(new SessionFile(path)).load()).resolves.toBeNull();
  });

  it('clears the session but keeps the Firebase entries', async () => {
    const file = new SessionFile(path);
    await file.update((content) => {
      content.firebase.user = { uid: 'u' };
    });
    const repo = new FileSessionRepository(file);
    await repo.save(ThndrSession.establish(RefreshCredential.of({ sid: 'r1' }), null, established));
    await repo.clear();
    await expect(repo.load()).resolves.toBeNull();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      firebase: { user: { uid: 'u' } },
      thndr: null,
    });
  });
});
