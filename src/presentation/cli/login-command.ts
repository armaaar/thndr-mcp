import type { UseCase } from '../../application/use-case';
import { runAndPresent } from '../presenters/outcome';
import type { View } from '../presenters/view';
import { EXIT_FAILURE, EXIT_OK } from './cli';

export interface PromptIo {
  prompt(question: string): Promise<string>;
  print(line: string): void;
}

type Fields = Record<string, View>;

class LoginStepError extends Error {}

/**
 * Guided `thndr login`: runs the identity use cases in order
 * (auth_status → login_start → login_verify_code | login_request_approval → login_complete).
 * It adds no logic of its own; every step goes through `runAndPresent`, exactly like a single CLI command.
 */
export async function runLoginCommand(
  useCases: readonly UseCase[],
  io: PromptIo,
  attempts = 5,
): Promise<number> {
  const run = async (name: string, input: Record<string, unknown> = {}): Promise<Fields> => {
    const useCase = useCases.find((u) => u.name === name);
    if (!useCase) throw new Error(`Use case ${name} is not registered`);
    const outcome = await runAndPresent(useCase, input);
    if (!outcome.ok) throw new LoginStepError(`${outcome.error.error}: ${outcome.error.message}`);
    return outcome.view as Fields;
  };

  try {
    const status = await run('auth_status');
    let instructions: Fields;
    if (status.identified === true) {
      io.print('Already identified with Thndr. Requesting a new approval on your phone…');
      instructions = await run('login_request_approval');
    } else {
      const email = (await io.prompt('Thndr account email: ')).trim();
      io.print(String((await run('login_start', { email })).message));
      const code = (await io.prompt('Verification code: ')).trim();
      instructions = await run('login_verify_code', { code });
    }
    io.print(String(instructions.message));
    io.print(`Deep link (open on your phone): ${String(instructions.deepLink)}`);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await run('login_complete', { timeoutSeconds: 60 });
      if (result.authenticated === true) {
        io.print(
          `✔ ${String(result.message)} Session valid until ${String(result.sessionExpiresAt ?? 'the server ends it')}.`,
        );
        return EXIT_OK;
      }
      io.print(String(result.message));
      if (result.status !== 'pending' && result.status !== 'unknown') return EXIT_FAILURE;
    }
    io.print('Gave up waiting for approval.');
    return EXIT_FAILURE;
  } catch (error) {
    if (!(error instanceof LoginStepError)) throw error;
    io.print(`Login failed — ${error.message}`);
    return EXIT_FAILURE;
  }
}
