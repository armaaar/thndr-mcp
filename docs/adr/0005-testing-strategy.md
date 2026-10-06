# 0005. Testing strategy and >95% coverage gate

- Status: Accepted
- Date: 2026-10-06

## Context

We cannot run integration tests against the real broker in CI (it needs a real funded account and interactive
2FA), and mistakes in a trading tool cost real money.

## Decision

- **Layout**: tests live next to the code they cover, in `__tests__/` folders (`src/<path>/__tests__/<file>.test.ts`);
  shared fakes and helpers are in `src/__tests__/support/` (`fake-fetch.ts`, `mcp-client.ts`, `fake-*.ts`). Vitest
  runs `src/**/__tests__/**/*.test.ts`.
- **Domain**: exhaustive unit tests (value-object validation, tick-size rules, order invariants).
- **Application**: one test file per use-case class (`application/<context>/{queries,commands}/__tests__/`), with
  in-memory fakes of every domain repository and application port; contract validation (`UseCase.run`,
  `INVALID_INPUT`) is tested too.
- **Infrastructure**: repository and gateway tests (`src/infrastructure/repositories/thndr/__tests__/`) with a stubbed
  `fetch` that asserts exact URLs, methods, headers and bodies, and feeds recorded/spec-derived JSON fixtures through
  the translators (`repositories/thndr/translators/`). Data sources (HTTP client, session file, Firebase
  persistence) are tested on their own. No real network.
- **Presentation** (`src/presentation/**/__tests__/`): use cases are tested end-to-end in-process through the MCP
  server (`registerUseCases`), using the SDK's `InMemoryTransport` and a real `Client`, against fake use-case
  dependencies; the presenters (`runAndPresent`, `toView`, `presentError`, `renderText`) and the CLI (argument
  parsing, positionals, help, exit codes, the guided `thndr login`) are tested directly.
  `src/presentation/__tests__/parity.test.ts` builds the real container and asserts that MCP and CLI expose the same
  use cases and return identical JSON for identical input, including failures and `INVALID_INPUT`
  ([ADR 0012](0012-use-case-classes-shared-by-mcp-and-cli.md)).
- Coverage is enforced by Vitest thresholds: lines, branches, functions and statements **≥ 95%** (target > 95%).
  The entrypoints `src/presentation/*/main.ts`, the `__tests__/` folders and barrel files are excluded; the
  composition root (`src/container.ts`) is covered by an end-to-end test (`src/__tests__/container.test.ts`).
- `npm run check` (typecheck + lint + coverage) must pass before every commit.

## Consequences

- High confidence in refactors without broker access.
- Fixtures must be kept in sync with `docs/api/` whenever the reverse-engineered spec changes.
