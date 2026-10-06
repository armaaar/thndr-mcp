# thndr-mcp — project instructions

Community, **unofficial** MCP server for [Thndr](https://thndr.app), an Egyptian Exchange (EGX) broker. Thndr has
no public API; we reverse-engineered the API used by its official web platform **ThndrX** (`https://x.thndr.app`).
The [IBKR MCP](docs/adr/0008-ibkr-mcp-as-reference.md) is the reference for the tool surface.

## Commands

| Task                     | Command                       |
| ------------------------ | ----------------------------- |
| Install                  | `npm install`                 |
| Run (dev, stdio)         | `npm run dev`                 |
| Interactive login (CLI)  | `npm run login`               |
| Build                    | `npm run build`               |
| Typecheck / lint / tests | `npm run typecheck` / `npm run lint` / `npm test` |
| Coverage (gate > 95%)    | `npm run coverage`            |
| **All gates**            | `npm run check`               |
| Re-sync the Thndr API    | `npm run sync:api` (see the `sync-thndr-api` skill) |

## Architecture (DDD + hexagonal — ADR 0003)

```
src/domain/          pure model, no I/O, no third-party imports
src/application/     use cases + ports (interfaces); depends only on domain
src/infrastructure/  adapters: thndr/ (anti-corruption layer: DTOs + mappers), firebase/, persistence/, logging/
src/interface/       MCP tools (zod schemas, presenters) and CLI
src/main.ts          composition root — the only place that wires concrete adapters
```

Rules:

- `domain` imports nothing outside `domain`. `application` imports only `domain` and `application`.
- Thndr wire formats (snake_case DTOs) stay inside `src/infrastructure/thndr/`. Map to domain objects there.
- Value objects are immutable (`Object.freeze`) and validate in their static factory (`X.of(...)`).
- One use-case class per file in `src/application/use-cases/`, with an `execute(input)` method.
- Never write to **stdout** — it is the MCP stdio channel. Log via the `Logger` port (stderr, redacted). `console.*`
  is a lint error in `src/`.
- Never log, print or commit tokens, refresh tokens, cookies or the session file.

## Bounded contexts

Identity & Access · Market Data · Portfolio (account, positions, orders, activity, journal) · Engagement (watchlists, alerts, notifications).
See `docs/domains/` for the ubiquitous language and `docs/use-cases/` for each use case.

## Scope (ADR 0006)

The server is read-only with respect to money: no tools place, modify or cancel orders or move funds. Do not add
any without a superseding ADR.

## Testing (ADR 0005)

- Vitest; tests live in `tests/` mirroring `src/`. No real network — use `tests/support/fake-fetch.ts`.
- Coverage thresholds are 95% for lines/branches/functions/statements; keep it above that.
- MCP tools are tested in-process with `InMemoryTransport` + a real MCP `Client`.

## Workflow

- Conventional Commits (`feat(portfolio): …`, `fix(infra): …`, `docs(adr): …`, `test: …`, `chore: …`).
  Commit author is `armaaar`. No AI co-author trailers.
- Run `npm run check` before committing.
- **Independent review**: after a meaningful change, ask the `qa-reviewer` agent (`.claude/agents/qa-reviewer.md`)
  to review. The author of a change never approves their own work.
- Any new architectural decision → new ADR in `docs/adr/` (copy `template.md`) and add it to the index.
- When the Thndr API changes, run `npm run sync:api`, diff `docs/api/endpoints.generated.md`, update
  `docs/api/*.md`, DTOs/mappers, fixtures and tests together.
