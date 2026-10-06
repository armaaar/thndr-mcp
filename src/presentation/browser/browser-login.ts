import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import { type GuidedLoginResult, type LoginDialog, runGuidedLogin } from '../presenters/guided-login';
import { renderQrSvg } from '../presenters/qr';
import { renderLoginPage } from './login-page';

/** What the login page shows; the page polls it. */
export type BrowserLoginState =
  | { step: 'working' }
  | { step: 'email' }
  | { step: 'code'; sent: string }
  | { step: 'approval'; request: string; message: string; deepLink: string; qrSvg: string; notes: string[] }
  | { step: 'done'; ok: boolean; message: string };

/** A running browser login: where it is, and how it ends. */
export interface BrowserLoginSession {
  url: string;
  /** Resolves once the user is logged in, or with "Login cancelled." as soon as the user cancels or the page expires. */
  result: Promise<GuidedLoginResult>;
  /** Resolves once the guided login behind the page has stopped (a cancelled one finishes its current step first). */
  settled: Promise<void>;
  cancel(): void;
}

export interface BrowserLoginOptions {
  logger?: Logger;
  /** How long the page accepts input before it closes (default 15 minutes). */
  lifetimeMs?: number;
  /** How long the page stays up after the login ended, so it can show the outcome (default 30 s). */
  lingerMs?: number;
  /** The page font (default: the bundled DM Sans). */
  font?: () => Promise<Buffer | null>;
}

export type StartBrowserLogin = (useCases: readonly UseCase[]) => Promise<BrowserLoginSession>;

const MAX_BODY_BYTES = 2048;

/** DM Sans (SIL Open Font License), served by this page itself so that it loads nothing from the internet. */
const FONT_FILE = '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2';

/** Reads the bundled font; without it (e.g. not installed) the page falls back to the system font. */
export function readFont(resolve: (id: string) => string): Promise<Buffer | null> {
  return Promise.resolve()
    .then(() => readFile(resolve(FONT_FILE)))
    .catch(() => null);
}

let font: Promise<Buffer | null> | null = null;
/** The bundled font, read once per process. */
export function loadFont(): Promise<Buffer | null> {
  font ??= readFont(createRequire(import.meta.url).resolve);
  return font;
}
const CANCELLED: GuidedLoginResult = { ok: false, message: 'Login cancelled.' };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Login page served on 127.0.0.1 (ADR 0017). It runs the guided login (`runGuidedLogin`, shared with `thndr login`)
 * with the browser as the `LoginDialog`: the email and code are typed into the page, and the phone approval QR code is
 * shown there while the server waits for the approval. Nothing passes through the MCP client or the model.
 *
 * Only this process can be talked to: the URL carries a random token, requests must use the 127.0.0.1/localhost host
 * (DNS rebinding), and state-changing requests must be same-origin JSON.
 */
export async function startBrowserLogin(
  useCases: readonly UseCase[],
  options: BrowserLoginOptions = {},
): Promise<BrowserLoginSession> {
  const { logger, lifetimeMs = 15 * 60_000, lingerMs = 30_000, font: pageFont = loadFont } = options;
  const token = randomBytes(24).toString('base64url');
  const nonce = () => randomBytes(16).toString('base64');

  let state: BrowserLoginState = { step: 'working' };
  let pending: { field: 'email' | 'code'; resolve: (value: string | null) => void } | null = null;
  let retry: (() => void) | null = null;
  let cancelled = false;
  const aborter = new AbortController();
  let onCancel: () => void = () => {};
  const cancellation = new Promise<GuidedLoginResult>((resolve) => {
    onCancel = () => resolve(CANCELLED);
  });

  const ask = (field: 'email' | 'code', next: BrowserLoginState) =>
    new Promise<string | null>((resolve) => {
      if (cancelled) return resolve(null);
      state = next;
      pending = { field, resolve };
    });

  const dialog: LoginDialog = {
    askEmail: () => ask('email', { step: 'email' }),
    askCode: (sent) => ask('code', { step: 'code', sent }),
    confirmApproval: async (approval) => {
      const qrSvg = await renderQrSvg(approval.deepLink);
      if (cancelled) return false; // never show a QR code nobody will wait for
      state = {
        step: 'approval',
        request: approval.humanId,
        message: approval.message,
        deepLink: approval.deepLink,
        qrSvg,
        notes: [],
      };
      return true; // the page shows the QR code while the guided login waits for the approval
    },
    notify: (line) => {
      if (state.step === 'approval') state.notes = [...state.notes, line];
    },
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    aborter.abort();
    state = { step: 'done', ok: false, message: CANCELLED.message };
    pending?.resolve(null);
    pending = null;
    retry?.();
    onCancel();
  };

  const login = (async (): Promise<GuidedLoginResult> => {
    let last: GuidedLoginResult = CANCELLED;
    while (!cancelled) {
      state = { step: 'working' };
      // Short approval waits, so that a cancelled login stops polling Thndr within seconds.
      last = await runGuidedLogin(useCases, dialog, {
        signal: aborter.signal,
        attempts: 30,
        waitSeconds: 10,
      }).catch((error: unknown) => {
        logger?.warn('login: browser login failed', { error });
        return {
          ok: false,
          message: `Login failed — ${error instanceof Error ? error.message : String(error)}`,
        };
      });
      if (last.ok || cancelled) break;
      state = { step: 'done', ok: false, message: last.message };
      await new Promise<void>((resolve) => {
        retry = resolve;
      });
      retry = null;
    }
    if (!last.ok) return CANCELLED;
    if (!cancelled) state = { step: 'done', ok: true, message: last.message };
    return last;
  })();
  // Cancelling ends the session at once, even while the guided login is still polling for the approval.
  const result = Promise.race([login, cancellation]);

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) logger?.warn('login: browser login request failed', { error });
      send(
        res,
        status,
        'application/json',
        JSON.stringify({ error: error instanceof Error ? error.message : 'error' }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const base = `/${token}/`;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      throw new HttpError(403, 'Forbidden host');
    }
    const path = new URL(req.url ?? '/', origin).pathname;
    if (!path.startsWith(base)) throw new HttpError(404, 'Not found');
    const route = `${req.method} ${path.slice(base.length)}`;

    if (route === 'GET ') {
      const scriptNonce = nonce();
      res.setHeader(
        'content-security-policy',
        `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; font-src 'self'; ` +
          "connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      return send(res, 200, 'text/html; charset=utf-8', renderLoginPage(scriptNonce));
    }
    if (route === 'GET state') return send(res, 200, 'application/json', JSON.stringify(state));
    if (route === 'GET font.woff2') {
      const bytes = await pageFont();
      if (!bytes) throw new HttpError(404, 'Not found');
      res.writeHead(200, {
        'content-type': 'font/woff2',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
      return;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');

    const origins = [origin, `http://localhost:${port}`];
    if (req.headers.origin !== undefined && !origins.includes(req.headers.origin)) {
      throw new HttpError(403, 'Forbidden origin');
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new HttpError(415, 'Expected JSON');
    }
    const body = await readJson(req);

    switch (route) {
      case 'POST email':
      case 'POST code': {
        const field = route === 'POST email' ? 'email' : 'code';
        const value = body[field];
        if (pending?.field !== field) throw new HttpError(409, `Not waiting for the ${field}`);
        if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `Missing ${field}`);
        const { resolve } = pending;
        pending = null;
        state = { step: 'working' };
        resolve(value);
        break;
      }
      case 'POST retry':
        if (!retry) throw new HttpError(409, 'Nothing to retry');
        retry();
        break;
      case 'POST cancel':
        cancel();
        break;
      default:
        throw new HttpError(404, 'Not found');
    }
    return send(res, 200, 'application/json', JSON.stringify(state));
  }

  const expiry = setTimeout(cancel, lifetimeMs);
  expiry.unref();
  void result.then(() => {
    clearTimeout(expiry);
    // close() alone keeps serving connections that are already open (HTTP keep-alive, the default in Node 19+), so a
    // polling tab or client could still reach the page: end those too.
    setTimeout(() => {
      server.close();
      server.closeAllConnections();
    }, lingerMs).unref();
  });

  return { url: `${origin}${base}`, result, settled: login.then(() => undefined), cancel };
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
