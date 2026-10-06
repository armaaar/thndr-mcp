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

export interface LoginFlowRecord {
  stage: 'IDLE' | 'CODE_SENT' | 'AWAITING_APPROVAL';
  email: string | null;
  verificationId: string | null;
  approval: { id: string; secret: string; humanId: string; createdAt: string } | null;
}

export interface SessionFileContent {
  version: 1;
  /** Firebase Auth persistence entries (ADR 0010). */
  firebase: Record<string, unknown>;
  thndr: ThndrSessionRecord | null;
  /** Pending interactive login (ADR 0013). */
  loginFlow: LoginFlowRecord | null;
}

const EMPTY: SessionFileContent = { version: 1, firebase: {}, thndr: null, loginFlow: null };

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
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  /**
   * Always reads from disk: the MCP server and CLI processes share this file, and a refresh in one process rotates
   * cookies the other must see (ADR 0013). The file is tiny, so this is cheap.
   */
  async read(): Promise<SessionFileContent> {
    try {
      const parsed = (JSON.parse(await readFile(this.path, 'utf8')) ?? {}) as Partial<SessionFileContent>;
      return {
        version: 1,
        firebase: parsed.firebase && typeof parsed.firebase === 'object' ? parsed.firebase : {},
        thndr: parsed.thndr ?? null,
        loginFlow: parsed.loginFlow ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      return structuredClone(EMPTY);
    }
  }

  update(mutate: (content: SessionFileContent) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const next = await this.read();
      mutate(next);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, this.path);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
