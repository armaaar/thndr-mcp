# 0005. Testing strategy and >95% coverage gate

- Status: Accepted
- Date: 2026-10-06

## Context

We cannot run integration tests against the real broker in CI (it needs a real funded account and interactive
2FA), and mistakes in a trading tool cost real money.

## Decision

- **Domain**: exhaustive unit tests (value-object validation, tick-size rules, order invariants).
- **Application**: use-case tests with in-memory fakes of every port.
- **Infrastructure**: adapter tests with a stubbed `fetch` that asserts exact URLs, methods, headers and bodies,
  and feeds recorded/spec-derived JSON fixtures through the mappers. No real network.
- **Interface**: MCP tools are tested end-to-end in-process using the SDK's `InMemoryTransport` and a real
  `Client`, against fake use-case dependencies.
- Coverage is enforced by Vitest thresholds: lines, branches, functions and statements **≥ 95%** (target > 95%).
  `src/main.ts` (composition root) and barrel files are excluded.
- `npm run check` (typecheck + lint + coverage) must pass before every commit.

## Consequences

- High confidence in refactors without broker access.
- Fixtures must be kept in sync with `docs/api/` whenever the reverse-engineered spec changes.
