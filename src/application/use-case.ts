import { z } from 'zod';
import { ApplicationError } from './errors';

/** Shape of a use case's input contract: field name → zod schema. */
export type InputShape = Record<string, z.ZodType>;

/** What callers may pass (optional and defaulted fields may be omitted). */
export type InputOf<Shape extends InputShape> = z.input<z.ZodObject<Shape>>;

export type BoundedContext = 'identity' | 'market-data' | 'portfolio' | 'engagement';

/**
 * An **application service**: one use case of the application layer (DDD). It owns its public contract — a stable
 * `name`, a human `title` and `description`, and an `input` schema — and implements `execute`.
 *
 * Delivery mechanisms (MCP server, CLI) depend only on this abstraction: they list use cases, describe them from the
 * contract, and call `run`, so every interface offers exactly the same operations (ADR 0012).
 */
export abstract class UseCase<Shape extends InputShape = InputShape, Output = unknown> {
  /** CQS: queries read, commands change state. */
  abstract readonly kind: 'query' | 'command';
  /** Stable snake_case identifier (MCP tool name; the CLI command is its kebab-case form). */
  abstract readonly name: string;
  abstract readonly title: string;
  abstract readonly description: string;
  abstract readonly context: BoundedContext;
  abstract readonly input: Shape;
  /** True when the use case only touches local state (no call to Thndr). */
  readonly local: boolean = false;

  abstract execute(input: InputOf<Shape>): Promise<Output>;

  /**
   * Validates untrusted input against the contract (unknown fields rejected, defaults applied), then executes.
   * This is the single entry point used by every delivery mechanism.
   */
  async run(rawInput: unknown): Promise<Output> {
    const parsed = z
      .object(this.input)
      .strict()
      .safeParse(rawInput ?? {});
    if (!parsed.success) throw new InvalidInputError(parsed.error.issues);
    return this.execute(parsed.data as InputOf<Shape>);
  }
}

/** A use case that only reads and has no observable side effect on domain state (CQS query). */
export abstract class Query<Shape extends InputShape = InputShape, Output = unknown> extends UseCase<
  Shape,
  Output
> {
  readonly kind = 'query' as const;
}

/** A primitive value a command receipt may carry. */
export type ReceiptValue = string | number | boolean | null | undefined;

/**
 * What a command returns under CQS: a flat acknowledgement (identifiers it created, flags, a message for the user),
 * never a read model. To observe the new state, run the corresponding query.
 */
export type Receipt = { readonly [field: string]: ReceiptValue | readonly ReceiptValue[] };

/**
 * A use case that changes state, in Thndr or locally (CQS command). Its output is constrained to a flat `Receipt`, so a
 * command cannot double as a query.
 */
export abstract class Command<
  Shape extends InputShape = InputShape,
  Output extends Receipt = Receipt,
> extends UseCase<Shape, Output> {
  readonly kind = 'command' as const;
  /** Irreversibly removes user data (e.g. deleting a watchlist). */
  readonly destructive: boolean = false;
  /** Repeating the call with the same input has no additional effect. */
  readonly idempotent: boolean = false;
}

/** The input did not satisfy the use case contract. */
export class InvalidInputError extends ApplicationError {
  readonly code = 'INVALID_INPUT';

  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path.length ? `${issue.path.map(String).join('.')}: ` : ''}${issue.message}`)
        .join('; '),
    );
  }
}
