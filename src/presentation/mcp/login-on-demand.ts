import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import type { BrowserLoginSession, StartBrowserLogin } from '../browser/browser-login';
import type { OpenUrl } from '../browser/open';
import type { GuidedLoginResult } from '../presenters/guided-login';

interface RunningLogin {
  session: BrowserLoginSession;
  result: Promise<GuidedLoginResult>;
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
 * browser login page and the tool waits for it, then is retried once. How the user reaches the page depends on the
 * client:
 *
 * - URL elicitation: the client offers to open the page and is told when the login completed.
 * - Form elicitation: the server opens the page and shows a short prompt with its link; it closes once logged in.
 * - Neither (e.g. clients without elicitation): the server opens the page; progress messages carry the link.
 *
 * Concurrent tool calls share one login. A call cancelled by the client leaves the page running: the user can finish
 * logging in and ask again.
 */
export class LoginOnDemand {
  /** The running login, set synchronously so that concurrent calls join it instead of starting another. */
  private inFlight: Promise<RunningLogin> | null = null;

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
    this.options.logger?.info(`login: ${notice}`);

    const done = new AbortController();
    const prompt = this.prompt(
      session,
      AbortSignal.any([done.signal, ...(call.signal ? [call.signal] : [])]),
    );
    const report = () => call.progress?.(notice).catch(() => undefined);
    void report();
    const ticker = setInterval(report, PROGRESS_EVERY_MS);
    try {
      return await running.result;
    } finally {
      clearInterval(ticker);
      done.abort();
      await prompt;
    }
  }

  private async begin(): Promise<RunningLogin> {
    const session = await this.options.start(this.useCases);
    const result = session.result
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.inFlight = null;
      });
    if (!this.server.getClientCapabilities()?.elicitation?.url) this.options.open(session.url);
    return { session, result };
  }

  private failed(error: unknown): GuidedLoginResult {
    this.options.logger?.warn('login: browser login failed', { error });
    return { ok: false, message: `Login failed — ${error instanceof Error ? error.message : String(error)}` };
  }

  /** Shows the page's link in the client, when it can; declining it cancels the login. Never rejects. */
  private async prompt(session: BrowserLoginSession, signal: AbortSignal): Promise<void> {
    const elicitation = this.server.getClientCapabilities()?.elicitation;
    const options = { signal, timeout: 15 * 60_000 };
    try {
      if (elicitation?.url) {
        const elicitationId = randomUUID();
        const answer = await this.server.elicitInput(
          { mode: 'url', message: 'Log in to Thndr in your browser.', url: session.url, elicitationId },
          options,
        );
        if (answer.action !== 'accept') return session.cancel();
        await session.result;
        await this.server.createElicitationCompletionNotifier(elicitationId)();
      } else if (elicitation?.form) {
        const answer = await this.server.elicitInput(
          {
            mode: 'form',
            message: `Log in to Thndr in the browser tab that just opened. This closes once you are logged in.\nNot opened? ${session.url}`,
            requestedSchema: { type: 'object', properties: {} },
          },
          options,
        );
        if (answer.action !== 'accept') session.cancel();
      }
    } catch (error) {
      if (!signal.aborted) this.options.logger?.debug('login: login prompt ended', { error });
    }
  }
}
