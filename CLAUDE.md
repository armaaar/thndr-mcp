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

## Architecture (5-layer Clean Architecture + CQS + context map — ADR 0015, use-case classes — ADR 0012)

```
src/domain/                1 Domain: <context>/ entities, value objects, repository interfaces; shared-kernel/ (Money, Ticker, AssetId, Market, errors)
src/application/           2 Application: use-case.ts (UseCase → Query | Command), <context>/{queries,commands,services}/, ports/
src/repositories/          3 Repositories: thndr/ (+ translators = anti-corruption layer), local/, memory/
src/data-sources/          4 Data sources: thndr/ (HTTP client, wire DTOs), firebase/, local/ (session file), logging/
src/presentation/          5 Presentation: presenters/, mcp/, cli/ (driving adapters + main.ts entrypoints)
src/container.ts           composition root — builds the `useCases` list (config in src/config.ts)
```

Rules (enforced by `src/__tests__/architecture.test.ts`):

- Dependencies point inward: domain → nothing; application → domain (+ zod); repositories → data-sources,
  application, domain; data-sources → application ports/errors only; presentation → application (+ shared-kernel
  errors). Only the composition root wires concrete classes.
- **CQS**: a `Query` reads and returns data; a `Command` changes state and returns a flat `Receipt` (ids, flags,
  messages — type-enforced). One use case per file in `queries/` or `commands/`. Use cases never call each other;
  shared logic goes in `services/`.
- **Context map**: Identity and Market Data depend on no other context; Portfolio and Engagement may use only Market
  Data's domain and `application/market-data/services/*`; nothing depends on Portfolio or Engagement. Shared concepts
  live in the shared kernel.
- A use case declares `name` (snake_case MCP tool name; CLI command = kebab-case), `title`, `description`, `context`,
  a zod `input` whose camelCase fields equal the `execute` params. Register it in `src/container.ts`; MCP and CLI
  expose it automatically through `runAndPresent` (parity). CLI-only positionals live in `presentation/cli/positionals.ts`.
- Imports are extensionless (ADR 0014). Thndr wire formats live only in `data-sources/thndr/dto` and
  `repositories/thndr/translators`.
- Value objects are immutable (`Object.freeze`) and validate in their static factory (`X.of(...)`).
- MCP mode never writes to stdout. The CLI prints results to stdout, errors to stderr. Log via the `Logger` port.
- Never log, print or commit tokens, refresh tokens, cookies or the session file.

## Bounded contexts

Identity & Access (generic) · Market Data (core, upstream supplier) · Portfolio (core, customer of Market Data) ·
Engagement (supporting, customer of Market Data). See the context map in ADR 0015.
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
