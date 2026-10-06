import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import type { BrowserLoginSession, StartBrowserLogin } from '../browser/browser-login';
import type { OpenUrl } from '../browser/open';
import type { GuidedLoginResult } from '../presenters/guided-login';

interface RunningLogin {
  session: BrowserLoginSession;
  result: Promise<GuidedLoginResult>;
  /** Whether the server could open the page in the browser. */
  opened: boolean;
}

/** Error codes that a successful login fixes. */
export const LOGIN_REQUIRED: ReadonlySet<string> = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED']);

/** How often a waiting tool call reports progress (keeps clients that reset their timeout on progress waiting). */
const PROGRESS_EVERY_MS = 15_000;

/** The tool call that triggered the login: its cancellation signal and, if it asked for progress, a reporter. */
export interface LoginCall {
  signal?: AbortSignal;
  progress?: (message: string) => Promise<void>;
}

export interface LoginOnDemandOptions {
  /** Starts the browser login page (ADR 0017). */
  start: StartBrowserLogin;
  /** Opens a URL in the user's browser. */
  open: OpenUrl;
  logger?: Logger;
}

/**
 * Login on demand (ADR 0016, ADR 0017): when a tool fails because there is no usable session, the server starts the
 * browser login page, opens it in the default browser and the tool waits for it, then is retried once. The server
 * always opens the page itself, so the user never has to agree to open it (MCP URL elicitation would ask first, and a
 * declined consent would cancel the login). Only if the browser could not be opened is the link shown in a form
 * prompt (when the client supports form elicitation); progress messages always carry it.
 *
 * Concurrent tool calls share one login. A call cancelled by the client leaves the page running: the user can finish
 * logging in and ask again.
 */
export class LoginOnDemand {
  /** The running login, set synchronously so that concurrent calls join it instead of starting another. */
  private inFlight: Promise<RunningLogin> | null = null;
  /** The previous login's background work, which must stop before a new login starts. */
  private settling: Promise<void> = Promise.resolve();

  constructor(
    private readonly server: Server,
    private readonly useCases: readonly UseCase[],
    private readonly options: LoginOnDemandOptions,
  ) {}

  /** Whether a failed call of `useCase` with `errorCode` should trigger a login. */
  applies(useCase: UseCase, errorCode: string): boolean {
    return LOGIN_REQUIRED.has(errorCode) && useCase.context !== 'identity';
  }

  async login(call: LoginCall = {}): Promise<GuidedLoginResult> {
    const starter = this.inFlight === null;
    let running: RunningLogin;
    try {
      this.inFlight ??= this.begin();
      running = await this.inFlight;
    } catch (error) {
      this.inFlight = null;
      return this.failed(error);
    }
    const { session } = running;
    const notice = `Log in to Thndr in your browser: ${session.url}`;
    this.options.logger?.debug(`login: ${notice}`); // the URL carries the page token: not at info level

    const done = new AbortController();
    const stop = AbortSignal.any([done.signal, ...(call.signal ? [call.signal] : [])]);
    // Only the call that started the login prompts: joined calls must not stack prompts, nor cancel it by declining.
    // Only when the browser could not be opened: clients may not close a prompt the server cancels (Claude Code
    // leaves it open), so a prompt shown alongside the open page would outlive the login.
    const prompt = starter && !running.opened ? this.prompt(session, stop) : Promise.resolve();
    const report = () => {
      if (!stop.aborted) void call.progress?.(notice).catch(() => undefined);
    };
    report();
    const ticker = setInterval(report, PROGRESS_EVERY_MS);
    stop.addEventListener('abort', () => clearInterval(ticker), { once: true });
    try {
      return await running.result;
    } finally {
      done.abort();
      await prompt;
    }
  }

  private async begin(): Promise<RunningLogin> {
    // A cancelled login finishes its current step in the background; never run two against the same login flow.
    await this.settling;
    const session = await this.options.start(this.useCases);
    this.settling = session.settled;
    const result = session.result
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.inFlight = null;
      });
    const opened = await this.options.open(session.url).catch(() => false);
    if (!opened)
      this.options.logger?.warn('login: could not open the browser; showing the login link instead');
    return { session, result, opened };
  }

  private failed(error: unknown): GuidedLoginResult {
    this.options.logger?.warn('login: browser login failed', { error });
    return { ok: false, message: `Login failed — ${error instanceof Error ? error.message : String(error)}` };
  }

  /** Shows the page's link in the client, when it can. Never rejects. */
  private async prompt(session: BrowserLoginSession, signal: AbortSignal): Promise<void> {
    const elicitation = this.server.getClientCapabilities()?.elicitation;
    const options = { signal, timeout: 15 * 60_000 };
    try {
      if (elicitation?.form) {
        // Whatever the user answers only hides the link: the login page stays usable (it has its own Cancel).
        await this.server.elicitInput(
          {
            mode: 'form',
            message: `Could not open your browser. Open this link to log in to Thndr: ${session.url}`,
            requestedSchema: { type: 'object', properties: {} },
          },
          options,
        );
      }
    } catch (error) {
      if (!signal.aborted) this.options.logger?.debug('login: login prompt ended', { error });
    }
  }
}
