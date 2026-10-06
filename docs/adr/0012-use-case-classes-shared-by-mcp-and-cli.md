# 0012. Self-describing use-case classes shared by MCP and CLI

- Status: Accepted
- Date: 2026-10-06

## Context

Users want two interfaces: an MCP server for Claude and other agents, and a terminal CLI for humans and scripts.
Both must offer **exactly the same operations**, backed by the same use cases and the same validation, so they can
never drift apart. A first design kept the contract (name, schema, description) in a separate "catalog" next to
the use cases. That split one concept in two and used a term that isn't DDD vocabulary.

## Decision

1. **Use cases are classes that own their contract** (OOP, CQRS vocabulary). `application/use-case.ts` defines:
   - `abstract class UseCase<Input, Output>`:
     - Abstract members: `name` (stable snake_case identifier), `title`, `description`, bounded `context`, an `input`
       zod schema, and `execute(input)`.
     - A concrete `run(rawInput)` that validates untrusted input (strict, defaults applied, `INVALID_INPUT` on
       failure) and then calls `execute`.
   - `abstract class Query extends UseCase`: reads only.
   - `abstract class Command extends UseCase`: changes state. Adds the `destructive` and `idempotent` flags.
2. **One use case per file**: `application/<context>/queries/<name>.ts` or `commands/<name>.ts`. The input field
   names are the `execute` parameters (camelCase). Validation lives in the application layer, where the contract is.
3. **The composition root lists the use cases** (`container.ts → useCases: UseCase[]`). That list is the
   application's published interface.
4. **Delivery mechanisms are thin driving adapters over `UseCase`.** Both call `runAndPresent(useCase, rawInput)`,
   which runs the use case and presents the result or the error.
   - **MCP** (`presentation/mcp`): each use case becomes a tool. The tool name, description and schema come from the
     class. Annotations are derived polymorphically: `Query` → read-only; `Command` → its `destructive` and
     `idempotent` flags; `local` → closed world.
   - **CLI** (`presentation/cli`, binary `thndr`):
     - Each use case becomes the command `thndr <kebab-name>`.
     - Flags are derived from the schema (`timeoutSeconds` → `--timeout-seconds`). Arrays may be repeated or
       comma-separated.
     - Positional arguments are CLI-only ergonomics, declared in `presentation/cli/positionals.ts`; use cases stay
       unaware of the CLI.
     - Output is a human-readable rendering of the same view model, or the exact MCP JSON with `--json`.
     - Exit codes: 0 ok, 1 operation error, 2 invalid usage or input.
5. **CLI conveniences add no logic.** `thndr login` runs the identity use cases in order through `runAndPresent`.
   `help` and `--version` are not use cases.
6. A parity test checks that both mechanisms expose the same use cases and return identical JSON for identical input.

## Consequences

- New capability = one new `Query` or `Command` subclass registered in `container.ts`; both apps expose it
  automatically.
- MCP tool arguments are camelCase (they are the use-case parameters).
- zod is a dependency of the application layer, used only for input contracts. The domain stays dependency-free.
