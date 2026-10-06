# 0005. Testing strategy and >95% coverage gate

- Status: Accepted
- Date: 2026-10-06

## Context

We cannot run integration tests against the real broker in CI (it needs a real funded account and interactive
2FA), and mistakes in a trading tool cost real money.

## Decision

- **Domain**: exhaustive unit tests (value-object validation, tick-size rules, order invariants).
- **Application**: use-case tests with in-memory fakes of every domain repository and application port.
- **Infrastructure**: repository and gateway tests (`src/infrastructure/repositories/thndr/`) with a stubbed
  `fetch` that asserts exact URLs, methods, headers and bodies, and feeds recorded/spec-derived JSON fixtures through
  the translators (`repositories/thndr/translators/`). Data sources (HTTP client, session file, Firebase
  persistence) are tested on their own. No real network.
- **Interfaces**: catalog operations are tested end-to-end in-process through the MCP server, using the SDK's
  `InMemoryTransport` and a real `Client`, against fake use-case dependencies; `executeOperation`, the presenters
  and the CLI (argument parsing, help, exit codes, the guided `thndr login`) are tested directly. MCP and CLI
  parity follows from both calling `executeOperation` over the same catalog
  ([ADR 0012](0012-shared-operation-catalog.md)).
- Coverage is enforced by Vitest thresholds: lines, branches, functions and statements **≥ 95%** (target > 95%).
  The entrypoints `src/interfaces/*/main.ts` and barrel files are excluded; the composition root
  (`src/container.ts`) is covered by an end-to-end test.
- `npm run check` (typecheck + lint + coverage) must pass before every commit.

## Consequences

- High confidence in refactors without broker access.
- Fixtures must be kept in sync with `docs/api/` whenever the reverse-engineered spec changes.
