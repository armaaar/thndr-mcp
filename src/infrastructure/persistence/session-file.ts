import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ThndrSessionRecord {
  cookies: Record<string, string>;
  refreshExpiresAt: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  establishedAt: string;
}

export interface SessionFileContent {
  version: 1;
  /** Firebase Auth persistence entries (ADR 0010). */
  firebase: Record<string, unknown>;
  thndr: ThndrSessionRecord | null;
}

const EMPTY: SessionFileContent = { version: 1, firebase: {}, thndr: null };

export function defaultSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.THNDR_SESSION_FILE) return env.THNDR_SESSION_FILE;
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'thndr-mcp', 'session.json');
}

/**
 * A small JSON document on disk holding all credentials (ADR 0007). Writes are serialised, atomic
 * (write temp + rename) and restricted to the owner (0600 file in a 0700 directory).
 */
export class SessionFile {
  private cache: SessionFileContent | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async read(): Promise<SessionFileContent> {
    if (this.cache) return this.cache;
    try {
      const parsed = (JSON.parse(await readFile(this.path, 'utf8')) ?? {}) as Partial<SessionFileContent>;
      this.cache = {
        version: 1,
        firebase: parsed.firebase && typeof parsed.firebase === 'object' ? parsed.firebase : {},
        thndr: parsed.thndr ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.cache = structuredClone(EMPTY);
    }
    return this.cache;
  }

  update(mutate: (content: SessionFileContent) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const next = structuredClone(await this.read());
      mutate(next);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, this.path);
      this.cache = next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
