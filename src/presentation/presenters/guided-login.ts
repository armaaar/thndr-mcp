import type { UseCase } from '../../application/use-case';
import { runAndPresent } from './outcome';
import type { View } from './view';

/** What the user must do on their phone to approve the login. */
export interface ApprovalPrompt {
  message: string;
  deepLink: string;
}

/**
 * How a delivery mechanism talks to the user during a guided login: the CLI prompts on the terminal, the MCP server
 * asks through MCP elicitation. Returning `null` / `false` means the user cancelled.
 */
export interface LoginDialog {
  askEmail(): Promise<string | null>;
  /** `sent` says where the code went (e.g. "Code sent to m***@example.com."). */
  askCode(sent: string): Promise<string | null>;
  /** Shows the approval instructions; resolves once the user is ready for the server to check the approval. */
  confirmApproval(approval: ApprovalPrompt): Promise<boolean>;
  /** Progress the user may want to see (e.g. "still waiting"). */
  notify(line: string): void;
}

export type GuidedLoginResult = { ok: boolean; message: string };

type Fields = Record<string, View>;

class LoginStepError extends Error {}

/**
 * Use-case messages also guide an agent ("Call login_complete again."); a person in the guided login does not call
 * tools, so those sentences are dropped.
 */
export function forPerson(message: string): string {
  return message
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/\blogin_[a-z_]+\b/.test(sentence))
    .join(' ');
}

/**
 * Guided login shared by `thndr login` and the MCP server's login-on-demand (ADR 0016). It runs the identity use cases
 * in order (auth_status → login_start → login_verify_code | login_request_approval → login_complete) and adds no
 * logic of its own: every step goes through `runAndPresent`, exactly like a single command or tool call.
 */
export async function runGuidedLogin(
  useCases: readonly UseCase[],
  dialog: LoginDialog,
  attempts = 5,
): Promise<GuidedLoginResult> {
  const run = async (name: string, input: Record<string, unknown> = {}): Promise<Fields> => {
    const useCase = useCases.find((u) => u.name === name);
    if (!useCase) throw new Error(`Use case ${name} is not registered`);
    const outcome = await runAndPresent(useCase, input);
    if (!outcome.ok) throw new LoginStepError(`${outcome.error.error}: ${forPerson(outcome.error.message)}`);
    return outcome.view as Fields;
  };
  const cancelled = { ok: false, message: 'Login cancelled.' };

  try {
    const status = await run('auth_status');
    let instructions: Fields;
    if (status.identified === true) {
      dialog.notify('Already identified with Thndr. Requesting a new approval on your phone…');
      instructions = await run('login_request_approval');
    } else {
      const email = (await dialog.askEmail())?.trim();
      if (!email) return cancelled;
      const sent = forPerson(String((await run('login_start', { email })).message));
      const code = (await dialog.askCode(sent))?.trim();
      if (!code) return cancelled;
      instructions = await run('login_verify_code', { code });
    }
    const approval = {
      message: forPerson(String(instructions.message)),
      deepLink: String(instructions.deepLink),
    };
    if (!(await dialog.confirmApproval(approval))) return cancelled;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await run('login_complete', { timeoutSeconds: 60 });
      if (result.authenticated === true) {
        return {
          ok: true,
          message: `✔ ${forPerson(String(result.message))} Session valid until ${String(result.sessionExpiresAt ?? 'the server ends it')}.`,
        };
      }
      if (result.status !== 'pending' && result.status !== 'unknown') {
        return { ok: false, message: forPerson(String(result.message)) };
      }
      dialog.notify(forPerson(String(result.message)));
    }
    return { ok: false, message: 'Gave up waiting for approval.' };
  } catch (error) {
    if (!(error instanceof LoginStepError)) throw error;
    return { ok: false, message: `Login failed — ${error.message}` };
  }
}
