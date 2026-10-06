import type { Logger } from '../../application/ports/logger';
import { InvalidInputError, type UseCase } from '../../application/use-case';
import { type ErrorView, presentError } from './error';
import { toView, type View } from './view';

/** What a delivery mechanism shows after running a use case. */
export type Outcome = { ok: true; view: View } | { ok: false; error: ErrorView; invalidInput: boolean };

/**
 * Runs a use case with untrusted input and presents the result or the failure. Every delivery mechanism goes through
 * this one function, so MCP and CLI produce identical views for identical input (ADR 0012).
 */
export async function runAndPresent(useCase: UseCase, rawInput: unknown, logger?: Logger): Promise<Outcome> {
  try {
    return { ok: true, view: toView(await useCase.run(rawInput)) };
  } catch (error) {
    return {
      ok: false,
      error: presentError(error, logger),
      invalidInput: error instanceof InvalidInputError,
    };
  }
}
