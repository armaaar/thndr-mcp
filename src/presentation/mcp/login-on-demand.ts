import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import { type GuidedLoginResult, type LoginDialog, runGuidedLogin } from '../presenters/guided-login';

/** Error codes that a successful login fixes. */
export const LOGIN_REQUIRED: ReadonlySet<string> = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED']);

/** How long the user has to answer one question (reading an email takes a while). */
const ANSWER_TIMEOUT_MS = 10 * 60_000;

type RequestedSchema = ElicitRequestFormParams['requestedSchema'];

/** The tool call that triggered the login: its cancellation signal and, if it asked for progress, a reporter. */
export interface LoginCall {
  signal?: AbortSignal;
  progress?: (message: string) => Promise<void>;
}

/**
 * The MCP side of the guided login: every question is an MCP form elicitation, so the user answers in the client's
 * own UI and the email and one-time code go straight to this server, never through the model.
 */
export function elicitationDialog(server: Server, logger?: Logger, call: LoginCall = {}): LoginDialog {
  const ask = async (
    message: string,
    requestedSchema: RequestedSchema,
  ): Promise<Record<string, unknown> | null> => {
    const result = await server.elicitInput(
      { mode: 'form', message, requestedSchema },
      { timeout: ANSWER_TIMEOUT_MS, ...(call.signal ? { signal: call.signal } : {}) },
    );
    return result.action === 'accept' ? (result.content ?? {}) : null;
  };
  const askText = async (message: string, field: string, title: string, format?: 'email') => {
    const content = await ask(message, {
      type: 'object',
      properties: { [field]: { type: 'string', title, minLength: 1, ...(format ? { format } : {}) } },
      required: [field],
    });
    return content === null ? null : String(content[field]);
  };

  return {
    askEmail: () =>
      askText(
        'Log in to Thndr to continue. Enter the email of your Thndr account and a 6-digit code will be sent to it.',
        'email',
        'Thndr account email',
        'email',
      ),
    askCode: (sent) => askText(`${sent} Enter the 6-digit code.`, 'code', 'Verification code'),
    confirmApproval: async (approval) =>
      (await ask(
        `${approval.message}\n\n${approval.qr}\nDeep link: ${approval.deepLink}\n\nAccept once you have approved it.`,
        { type: 'object', properties: {} },
      )) !== null,
    notify: (line) => {
      logger?.info(`login: ${line}`);
      // Progress keeps clients that reset their timeout on progress waiting, and shows the user what is happening.
      call
        .progress?.(line)
        .catch((error: unknown) => logger?.debug('login: progress not delivered', { error }));
    },
  };
}

/**
 * Login on demand (ADR 0016): when a tool fails because there is no usable session and the client supports form
 * elicitation, the server runs the guided login itself and the tool is retried. Concurrent tool calls share one login.
 */
export class LoginOnDemand {
  private inFlight: Promise<GuidedLoginResult> | null = null;

  constructor(
    private readonly server: Server,
    private readonly useCases: readonly UseCase[],
    private readonly logger?: Logger,
  ) {}

  /** Whether a failed call of `useCase` with `errorCode` should trigger a login. */
  applies(useCase: UseCase, errorCode: string): boolean {
    return (
      LOGIN_REQUIRED.has(errorCode) &&
      useCase.context !== 'identity' &&
      Boolean(this.server.getClientCapabilities()?.elicitation?.form)
    );
  }

  /** Runs the guided login, or joins the one already running (which keeps the first call's signal and progress). */
  login(call: LoginCall = {}): Promise<GuidedLoginResult> {
    this.inFlight ??= runGuidedLogin(this.useCases, elicitationDialog(this.server, this.logger, call))
      .catch((error: unknown): GuidedLoginResult => {
        this.logger?.warn('login: guided login failed', { error });
        return {
          ok: false,
          message: `Login failed — ${error instanceof Error ? error.message : String(error)}`,
        };
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
