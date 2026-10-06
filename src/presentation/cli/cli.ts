import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import { runAndPresent } from '../presenters/outcome';
import { renderText } from '../presenters/text';
import { CliUsageError, parseCommandArgs } from './args';
import { renderCommandHelp, renderOverview } from './help';
import { commandName } from './positionals';

export interface CliOutput {
  out(text: string): void;
  err(text: string): void;
}

export interface CliOptions {
  useCases: readonly UseCase[];
  version: string;
  io: CliOutput;
  logger?: Logger;
  /** CLI-only convenience: the guided `login` (a sequence of the identity use cases). */
  interactiveLogin?: () => Promise<number>;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

function findUseCase(useCases: readonly UseCase[], name: string): UseCase | undefined {
  return useCases.find((u) => commandName(u) === name || u.name === name);
}

/**
 * Driving adapter for the terminal: maps `thndr <command> …` to a use case and runs it through `runAndPresent` —
 * the same path the MCP server uses. Returns the process exit code.
 */
export async function runCli(argv: readonly string[], options: CliOptions): Promise<number> {
  const { io, useCases } = options;
  const [first, ...rest] = argv;

  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    if (first === 'help' && rest[0]) {
      const target = findUseCase(useCases, rest[0]);
      if (!target) {
        io.err(`Unknown command "${rest[0]}". Run \`thndr help\` to list commands.`);
        return EXIT_USAGE;
      }
      io.out(renderCommandHelp(target));
      return EXIT_OK;
    }
    io.out(renderOverview(useCases, options.version));
    return EXIT_OK;
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    io.out(options.version);
    return EXIT_OK;
  }
  if (first === 'login' && options.interactiveLogin) return options.interactiveLogin();

  const useCase = findUseCase(useCases, first);
  if (!useCase) {
    const stem = first.replace(/^-+/, '').split('-')[0] ?? '';
    const close = useCases.map(commandName).filter((n) => stem.length > 0 && n.includes(stem));
    io.err(
      `Unknown command "${first}".${close.length ? ` Did you mean: ${close.slice(0, 5).join(', ')}?` : ''} Run \`thndr help\`.`,
    );
    return EXIT_USAGE;
  }

  let parsed: ReturnType<typeof parseCommandArgs>;
  try {
    parsed = parseCommandArgs(useCase, rest);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    io.err(`${error.message}\n\n${renderCommandHelp(useCase)}`);
    return EXIT_USAGE;
  }
  if (parsed.help) {
    io.out(renderCommandHelp(useCase));
    return EXIT_OK;
  }

  const outcome = await runAndPresent(useCase, parsed.input, options.logger);
  if (!outcome.ok) {
    io.err(
      parsed.json
        ? JSON.stringify(outcome.error, null, 2)
        : `Error [${outcome.error.error}]: ${outcome.error.message}`,
    );
    return outcome.invalidInput ? EXIT_USAGE : EXIT_FAILURE;
  }
  io.out(parsed.json ? JSON.stringify(outcome.view, null, 2) : renderText(outcome.view));
  return EXIT_OK;
}
