import type { UseCase } from '../../application/use-case';
import { type LoginDialog, runGuidedLogin } from '../presenters/guided-login';
import { EXIT_FAILURE, EXIT_OK } from './cli';

export interface PromptIo {
  prompt(question: string): Promise<string>;
  print(line: string): void;
}

/** The terminal side of the guided login: questions on the prompt, everything else printed. */
export function terminalDialog(io: PromptIo): LoginDialog {
  return {
    askEmail: () => io.prompt('Thndr account email: '),
    askCode: (sent) => {
      io.print(sent);
      return io.prompt('Verification code: ');
    },
    confirmApproval: async (approval) => {
      io.print(approval.message);
      io.print(approval.qr);
      io.print(`Deep link (open on your phone): ${approval.deepLink}`);
      return true; // the CLI simply starts polling for the approval
    },
    notify: (line) => io.print(line),
  };
}

/** `thndr login`: the guided login (ADR 0016) on the terminal. */
export async function runLoginCommand(
  useCases: readonly UseCase[],
  io: PromptIo,
  attempts = 5,
): Promise<number> {
  const result = await runGuidedLogin(useCases, terminalDialog(io), { attempts });
  io.print(result.message);
  return result.ok ? EXIT_OK : EXIT_FAILURE;
}
