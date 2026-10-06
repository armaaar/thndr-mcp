# thndr-mcp — project instructions

Community, **unofficial** MCP server **and CLI** for [Thndr](https://thndr.app), an Egyptian Exchange (EGX) broker.
Thndr has no public API; we reverse-engineered the API used by its official web platform **ThndrX**
(`https://x.thndr.app`). The [IBKR MCP](docs/adr/0008-ibkr-mcp-as-reference.md) is the reference for the operations.

## Commands

| Task                     | Command                       |
| ------------------------ | ----------------------------- |
| Install                  | `npm install`                 |
| MCP server (dev, stdio)  | `npm run dev`                 |
| CLI (dev)                | `npm run cli -- <command> …` (e.g. `npm run cli -- get-price-snapshot COMI`) |
| Interactive login        | `npm run login` (= `thndr login`) |
| Build                    | `npm run build` (tsup → `dist/thndr-mcp.js`, `dist/thndr.js`) |
| Typecheck / lint / tests | `npm run typecheck` / `npm run lint` / `npm test` |
| Coverage (gate > 95%)    | `npm run coverage`            |
| **All gates**            | `npm run check`               |
| Re-sync the Thndr API    | `npm run sync:api` / `npm run capture:fixtures` (tools live in the `sync-thndr-api` skill) |

## Architecture (DDD layers — ADR 0011, use-case classes — ADR 0012)

```
src/domain/<context>/                 entities, value objects, aggregates, repository interfaces (repository.ts)
src/domain/shared-kernel/             Shared Kernel: Money, Ticker, domain errors, guards
src/application/use-case.ts           abstract UseCase → Query | Command (contract + execute + run)
src/application/<context>/queries/    one Query use case per file
src/application/<context>/commands/   one Command use case per file
src/application/<context>/services/   application services shared by the use cases (plain helpers — inputs, views, constants,
                                      dependencies.ts — sit at the context root; cross-context helpers at application/)
src/application/ports/                non-repository ports: Clock, Logger, AccessTokenProvider, ThndrAuthGateway, IdentityProvider
src/infrastructure/repositories/      repository implementations (thndr/, local/, memory/) + thndr/translators (anti-corruption layer)
src/infrastructure/data-sources/      raw external access: thndr/ (HTTP client, wire DTOs), firebase/, local/ (session file)
src/infrastructure/logging/           redacting stderr logger
src/presentation/presenters/          view models, error presentation, terminal text, runAndPresent
src/presentation/mcp/, cli/           driving adapters (delivery mechanisms) + entrypoints (main.ts)
src/container.ts                      composition root — builds the `useCases` list (config in src/config.ts)
```

Rules:

- Dependency rule: `domain` imports nothing outside `domain`; `application` → `domain` (+ zod for input
  contracts); `infrastructure` → `application` (ports, errors) + `domain`; `presentation` → `application` + `domain`.
- Imports are **extensionless** (`from './money'`), per ADR 0014. `tsc` only typechecks; `tsup` bundles.
- A use case is a class extending `Query` or `Command`. It declares `name` (snake_case, the MCP tool name; the CLI
  command is kebab-case), `title`, `description`, `context`, a zod `input` whose camelCase fields equal the
  `execute` params, and `execute`. Register it in `src/container.ts`; MCP and CLI expose it automatically.
- Never put use-case logic in `presentation/`. Both apps run use cases through `runAndPresent` (MCP/CLI parity).
  CLI-only ergonomics (positional args) live in `presentation/cli/positionals.ts`.
- Thndr wire formats (snake_case DTOs) live only in `infrastructure/data-sources/thndr/dto` and the translators.
- Value objects are immutable (`Object.freeze`) and validate in their static factory (`X.of(...)`).
- MCP mode must never write to **stdout** (it is the stdio channel). The CLI prints results to stdout and errors to
  stderr. Log via the `Logger` port (stderr, redacted). `console.*` is a lint error in `src/`.
- Never log, print or commit tokens, refresh tokens, cookies or the session file.

## Bounded contexts

Identity & Access · Market Data · Portfolio (account, positions, orders, activity, journal) · Engagement (watchlists, alerts, notifications).
See `docs/domains/` for the ubiquitous language and `docs/use-cases/` for each use case.

## Scope (ADR 0006)

The app is read-only with respect to money: no operations place, modify or cancel orders or move funds. Do not add
any without a superseding ADR.

## Testing (ADR 0005)

- Vitest; tests live next to the code in `__tests__/` folders (`src/<path>/__tests__/<file>.test.ts`); shared
  helpers in `src/__tests__/support/`. No real network — use `src/__tests__/support/fake-fetch.ts`.
- Coverage thresholds are 95% for lines/branches/functions/statements; keep it above that.
- MCP tools are tested in-process with `InMemoryTransport` + a real MCP `Client`; the CLI via `runCli` with
  captured output. `src/presentation/__tests__/parity.test.ts` asserts both return identical results.

## Workflow

- Conventional Commits (`feat(portfolio): …`, `fix(infra): …`, `docs(adr): …`, `test: …`, `chore: …`).
  Commit author is `armaaar`. No AI co-author trailers.
- Run `npm run check` before committing.
- **Independent review**: after a meaningful change, ask the `qa-reviewer` agent (`.claude/agents/qa-reviewer.md`)
  to review. The author of a change never approves their own work.
- Any new architectural decision → new ADR in `docs/adr/` (copy `template.md`) and add it to the index.
- When the Thndr API changes, run `npm run sync:api`, diff `docs/api/endpoints.generated.md`, update
  `docs/api/*.md`, DTOs/translators, fixtures and tests together.
