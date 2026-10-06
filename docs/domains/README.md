# Strategic design

thndr-mcp lets an LLM agent analyse the EGX market and a Thndr account holder's portfolio, safely and read-only
([ADR 0006](../adr/0006-trading-safety.md)). The model is split into four bounded contexts plus a small shared
kernel ([ADR 0003](../adr/0003-ddd-hexagonal-architecture.md)), organised in Evans' four layers
([ADR 0011](../adr/0011-ddd-layered-architecture.md)). The same use cases are offered to agents through an MCP
server and to humans through the `thndr` CLI ([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)).

## Subdomains

| Type | Subdomain | Why |
| --- | --- | --- |
| **Core** | Market analysis | Search, quotes, history, depth, tape and screening are what make the server useful to an agent. |
| **Core** | Portfolio insight | Cash, positions, order history, realized returns and trading-journal metrics — analysis of the user's own trading. |
| **Supporting** | Engagement | Watchlists, price alerts and notifications: useful list management, but not a differentiator. |
| **Generic** | Identity | Getting and keeping a Thndr session. Hard because it is interactive (phone approval), but not business logic. |

## Bounded contexts

| Context | Responsibility | Domain (incl. `repository.ts`) | Application (use cases in `queries/`, `commands/`; shared `services/`) | Doc |
| --- | --- | --- | --- | --- |
| Identity & Access | Interactive login, device approval, token refresh, session persistence | `src/domain/identity/` | `src/application/identity/` (+ ports `ports/identity.ts`, `ports/access-token-provider.ts`) | [identity-and-access.md](identity-and-access.md) |
| Market Data | Instruments, quotes, candles, order book, tape, market session, screening | `src/domain/market-data/` | `src/application/market-data/` | [market-data.md](market-data.md) |
| Portfolio | Account summary, positions, sellable quantity, orders (read-only), returns, journal, activity | `src/domain/portfolio/` | `src/application/portfolio/` | [portfolio.md](portfolio.md) |
| Engagement | Watchlists, price alerts, notifications | `src/domain/engagement/` | `src/application/engagement/` | [engagement.md](engagement.md) |

Repository interfaces: `MarketDataRepository`, `PortfolioRepository`, `EngagementRepository`, and for identity
`SessionRepository` + `LoginFlowRepository` — each in `src/domain/<context>/repository.ts`.

### Relationships

- **Portfolio → Market Data** and **Engagement → Market Data** (customer/supplier): both use
  `InstrumentResolver` (and Engagement also `MarketQuotesCache`, via `InstrumentLabeler`) to translate between
  tickers and Thndr asset ids. They reuse Market Data value objects (`AssetId`, `Market`, `AssetClass`) rather than
  defining their own.
- **Every context → Identity & Access** (conformist on a port): Thndr HTTP calls get their bearer token from the
  `AccessTokenProvider` port; on a 401/403 the HTTP client calls `invalidate()` and retries once.
- **All contexts → Thndr API** through the anti-corruption layer (below).

See the context map in [docs/README.md](../README.md#context-map).

## Layers — [ADR 0011](../adr/0011-ddd-layered-architecture.md)

| Layer | Folder | Contains (DDD building blocks) | Clean-architecture name |
| --- | --- | --- | --- |
| Domain | `src/domain/<context>/` | Entities, value objects, aggregates, domain services, **repository interfaces** (`repository.ts`) | Entities + repository contracts |
| Domain | `src/domain/shared-kernel/` | **Shared kernel**: `Money`, `Ticker`, domain errors, guards | — |
| Application | `src/application/use-case.ts` | Abstract `UseCase` and its CQRS subclasses `Query` and `Command` ([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)) | Use-case boundary |
| Application | `src/application/<context>/queries/`, `commands/` | **Use cases** (application services): one `Query` or `Command` subclass per file, owning its contract (`name`, `title`, `description`, `context`, zod `input`) and `execute` | Use cases |
| Application | `src/application/<context>/services/` | Application services shared by the use cases: `InstrumentResolver`, `MarketQuotesCache`, `SessionTokenProvider`, `InstrumentLabeler` | — |
| Application | `src/application/ports/` | Ports that are not repositories: `Clock`, `Logger`, `AccessTokenProvider`, `ThndrAuthGateway`, `IdentityProvider` | — |
| Application | `src/application/errors.ts`, `inputs.ts` | Application errors and reusable input fields (`marketInput`, `symbolInput`, `dateInput`, `pageInput`) shared by all contexts | — |
| Infrastructure | `src/infrastructure/repositories/` | Repository implementations: `thndr/*-repository.ts` + `thndr/auth-gateway.ts`, `local/` (session file), `memory/` (tests); **translators** in `thndr/translators/` | Repositories |
| Infrastructure | `src/infrastructure/data-sources/` | Raw access to external systems in *their* language: `thndr/` (HTTP client, KrakenD guard, wire DTOs), `firebase/` (official SDK), `local/session-file.ts` | Data sources |
| Infrastructure | `src/infrastructure/logging/` | Redacting stderr logger ([ADR 0009](../adr/0009-stdio-transport-and-logging.md)) | — |
| Presentation | `src/presentation/presenters/` | `toView` (view models), `presentError`, `renderText` (terminal tables), `runAndPresent` | Presenters |
| Presentation | `src/presentation/mcp/`, `src/presentation/cli/` | Delivery mechanisms (driving adapters) and their entrypoints `main.ts` | Controllers / apps |
| — | `src/container.ts` | Composition root (manual DI): builds infrastructure and application services, returns the `useCases` list | Main / DI |

### Dependency rule

```
presentation ──▶ application ──▶ domain
infrastructure ──▶ application (ports, errors) ──▶ domain
container.ts wires everything; entrypoints are presentation/{mcp,cli}/main.ts
```

- `domain` imports nothing outside `domain`: no I/O, no framework, no third-party code.
- `application` imports only `domain` and `application` (plus zod, for input contracts only). Use cases take their collaborators as a dependency object
  (`repository` for market data, portfolio and engagement; `gateway` = `ThndrAuthGateway`, `identity`,
  `sessions`, `flow` for identity).
- `infrastructure` implements domain repositories and application ports; it never imports `presentation`.
- `presentation` imports `application` and `domain` (plus zod and the MCP SDK); never `infrastructure`.
- Only `src/container.ts` and the entrypoints `src/presentation/{mcp,cli}/main.ts` reference concrete infrastructure.
- Imports are extensionless (`from './money'`); `tsc` only typechecks and tsup bundles the two binaries
  ([ADR 0014](../adr/0014-extensionless-imports-and-bundled-build.md)).
- Value objects are immutable (`Object.freeze`) and validate in their static factory (`X.of(...)`); entity-like
  read models are built by `createX(...)` factories that validate and derive fields.
- Nothing writes to stdout except the delivery mechanism that owns it (the MCP channel for `thndr-mcp`, command
  output for `thndr`). Tokens, cookies and the session file are never logged.

## Shared kernel — `src/domain/shared-kernel/`

Small, stable concepts every context may use. Changes here affect everyone, so keep it minimal.

| Module | Contents |
| --- | --- |
| `errors.ts` | `DomainError` (abstract, has `code`), `ValidationError` (`VALIDATION_ERROR`), `BusinessRuleViolation` (custom code). |
| `guards.ts` | `assertFiniteNumber`, `assertPositive`, `assertPositiveInteger`, `assertNonEmpty`, `roundTo` (float-safe rounding). |
| `money.ts` | `Money` value object (amount rounded to 4 decimals, currency `EGP` or `USD`, same-currency arithmetic). |
| `ticker.ts` | `Ticker` value object: trimmed, upper-cased, `^[A-Z0-9][A-Z0-9._-]{0,14}$`. |

Application-level errors (`src/application/errors.ts`) are shared across contexts too: `NOT_AUTHENTICATED`,
`SESSION_EXPIRED`, `NOT_FOUND`, `UPSTREAM_ERROR`, `FEATURE_DISABLED`. The presenter `presentError`
(`src/presentation/presenters/error.ts`) turns any `DomainError` or `ApplicationError` into
`{ error: <code>, message }` (plus `status`/`upstreamCode` for upstream errors); anything else becomes
`INTERNAL_ERROR`. Input rejected by a use case's zod contract in `UseCase.run` becomes `INVALID_INPUT` (`InvalidInputError`, in
`src/application/use-case.ts`). MCP and CLI show the same
codes.

## Anti-corruption layer — translators + Thndr data source

Thndr has no public API; we act as a browser-equivalent client of ThndrX
([ADR 0004](../adr/0004-reverse-engineer-thndrx-web-client.md)). Its payloads are snake_case, loosely typed and
may change without notice. Thndr's wire format may appear **only** in `src/infrastructure/data-sources/thndr/dto/`
and in the translators:

| Piece | Role |
| --- | --- |
| `data-sources/thndr/http-client.ts` | `ThndrHttpClient`: adds `Authorization: Bearer`, `x-thndrx-runtime-version`, `X-Language`, `X-Correlation-ID`; retries once after 401/403 with a refreshed token; maps non-2xx to `UpstreamError` (extracting message/code from FastAPI, Next.js and other error shapes). |
| `data-sources/thndr/krakend.ts` | `assertNoKrakendError`: the KrakenD gateway (`/krakend-thndr-x`) answers 200 with an `error_*` key when a backend fails; this turns it into an `UpstreamError`. |
| `data-sources/thndr/dto/` | Wire types (`market-data.ts`, `portfolio.ts`, `engagement.ts`) — the only place snake_case field names live. |
| `data-sources/thndr/wire.ts` | Decoding helpers: timestamps (epoch s/ms/ISO), numbers from formatted strings, JWT `exp`, `Set-Cookie`. |
| `repositories/thndr/translators/` | **The anti-corruption layer proper**: pure DTO → domain functions. Malformed rows are skipped (`mapRows`), mandatory fields missing → `UpstreamError`. |
| `repositories/thndr/market-data-repository.ts`, `portfolio-repository.ts`, `engagement-repository.ts` | `ThndrMarketDataRepository`, `ThndrPortfolioRepository`, `ThndrEngagementRepository`: implement the domain repositories (paths, params, translation). |
| `repositories/thndr/auth-gateway.ts` | `HttpThndrAuthGateway`: implements the `ThndrAuthGateway` application port. |

Other infrastructure: `src/infrastructure/data-sources/firebase/` (Firebase Auth via the official SDK with
file-backed persistence, [ADR 0010](../adr/0010-prefer-official-sdks.md)),
`src/infrastructure/data-sources/local/session-file.ts` (the shared session file, mode `0600`, uncached,
[ADR 0013](../adr/0013-persisted-login-flow-and-shared-session.md)) used by
`src/infrastructure/repositories/local/` (`FileSessionRepository`, `FileLoginFlowRepository`), and
`src/infrastructure/logging/` (redacting stderr logger).

## Use cases and the presentation layer — one list, two delivery mechanisms

| Piece | Role |
| --- | --- |
| `application/use-case.ts` | `UseCase` (abstract): `name` (snake_case MCP tool name; CLI command = kebab-case), `title`, `description`, bounded `context`, zod `input` (camelCase fields = `execute` parameters), `local` flag, `execute(input)`, and `run(rawInput)`, which validates strictly (unknown fields rejected, defaults applied, `INVALID_INPUT` on failure) and then calls `execute`. `Query` (`kind = 'query'`) reads; `Command` (`kind = 'command'`) changes state and adds the `destructive` / `idempotent` flags. |
| `application/<context>/{queries,commands}/<name>.ts` | One use-case class per file (e.g. `GetPriceHistory` in `market-data/queries/get-price-history.ts`). Shared helpers live in `services/` and in small modules next to them (`inputs.ts`, `paging.ts`, `journal-input.ts`). |
| `container.ts` | `compose(config)` returns `useCases: UseCase[]`, the application's published interface, in the order users see it. |
| `presentation/presenters/` | `view.ts` (`toView`), `error.ts` (`presentError`), `text.ts` (`renderText`, `renderTable` for the CLI), `outcome.ts` (`runAndPresent(useCase, rawInput)`: `useCase.run` → `toView` / `presentError`). The **single execution path** of both apps. |
| `presentation/mcp/` | `server.ts`: `registerUseCases` registers every use case as an MCP tool with its own name, title, description and `toolInputSchema` (advertises the strict contract, leaves validation to `UseCase.run`); `annotationsFor` derives `readOnlyHint`, `destructiveHint`, `idempotentHint` (`instanceof Command` + flags) and `openWorldHint` (`!local`). Results are JSON text plus `structuredContent`. `main.ts` = `thndr-mcp` binary (stdio). |
| `presentation/cli/` | `cli.ts` (`runCli`) maps `thndr <command>` to a use case; `args.ts` derives `--kebab-case` flags from the zod contract (arrays repeated or comma-separated); `positionals.ts` holds `CLI_POSITIONALS` (CLI-only positional arguments, keyed by use-case name), `commandName` and `flagName`; `help.ts` renders help from the contracts; `login-command.ts` is the guided `thndr login` (a sequence of identity use cases through `runAndPresent`, no logic of its own). Output: `renderText`, or the exact MCP JSON with `--json`. Exit codes 0 ok, 1 use-case error, 2 usage/invalid input. `main.ts` = `thndr` binary. |

A new capability is one new `Query` or `Command` subclass registered in `src/container.ts`; both apps expose it
automatically. `src/presentation/__tests__/parity.test.ts` asserts that both expose the same use cases and return identical
JSON for identical input.
