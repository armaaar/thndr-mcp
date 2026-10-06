# Strategic design

thndr-mcp lets an LLM agent analyse the EGX market and a Thndr account holder's portfolio, safely and read-only
([ADR 0006](../adr/0006-trading-safety.md)). The model is split into four bounded contexts plus a small shared
kernel ([ADR 0003](../adr/0003-ddd-hexagonal-architecture.md)), organised in Evans' four layers
([ADR 0011](../adr/0011-ddd-layered-architecture.md)). The same operations are offered to agents through an MCP
server and to humans through the `thndr` CLI ([ADR 0012](../adr/0012-shared-operation-catalog.md)).

## Subdomains

| Type | Subdomain | Why |
| --- | --- | --- |
| **Core** | Market analysis | Search, quotes, history, depth, tape and screening are what make the server useful to an agent. |
| **Core** | Portfolio insight | Cash, positions, order history, realized returns and trading-journal metrics — analysis of the user's own trading. |
| **Supporting** | Engagement | Watchlists, price alerts and notifications: useful list management, but not a differentiator. |
| **Generic** | Identity | Getting and keeping a Thndr session. Hard because it is interactive (phone approval), but not business logic. |

## Bounded contexts

| Context | Responsibility | Domain (incl. `repository.ts`) | Application | Catalog | Doc |
| --- | --- | --- | --- | --- | --- |
| Identity & Access | Interactive login, device approval, token refresh, session persistence | `src/domain/identity/` | `src/application/identity/` (+ ports `ports/identity.ts`, `ports/access-token-provider.ts`) | `src/interfaces/catalog/identity.ts` | [identity-and-access.md](identity-and-access.md) |
| Market Data | Instruments, quotes, candles, order book, tape, market session, screening | `src/domain/market-data/` | `src/application/market-data/` | `src/interfaces/catalog/market-data.ts` | [market-data.md](market-data.md) |
| Portfolio | Account summary, positions, sellable quantity, orders (read-only), returns, journal, activity | `src/domain/portfolio/` | `src/application/portfolio/` | `src/interfaces/catalog/portfolio.ts` | [portfolio.md](portfolio.md) |
| Engagement | Watchlists, price alerts, notifications | `src/domain/engagement/` | `src/application/engagement/` | `src/interfaces/catalog/engagement.ts` | [engagement.md](engagement.md) |

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
| Application | `src/application/<context>/` | **Application services** (one class per use case, `execute(input)`) and `InstrumentResolver`, `MarketQuotesCache`, `SessionTokenProvider` | Use cases |
| Application | `src/application/ports/` | Ports that are not repositories: `Clock`, `Logger`, `AccessTokenProvider`, `ThndrAuthGateway`, `IdentityProvider` | — |
| Application | `src/application/errors.ts` | Application errors shared by all contexts | — |
| Infrastructure | `src/infrastructure/repositories/` | Repository implementations: `thndr/*-repository.ts` + `thndr/auth-gateway.ts`, `local/` (session file), `memory/` (tests); **translators** in `thndr/translators/` | Repositories |
| Infrastructure | `src/infrastructure/data-sources/` | Raw access to external systems in *their* language: `thndr/` (HTTP client, KrakenD guard, wire DTOs), `firebase/` (official SDK), `local/session-file.ts` | Data sources |
| Infrastructure | `src/infrastructure/logging/` | Redacting stderr logger ([ADR 0009](../adr/0009-stdio-transport-and-logging.md)) | — |
| Interfaces | `src/interfaces/catalog/` | The **command & query catalog**: one `Operation` per application service, `executeOperation` ([ADR 0012](../adr/0012-shared-operation-catalog.md)) | Controllers |
| Interfaces | `src/interfaces/presenters/` | `toView` (view models), `presentError`, `renderText` (terminal tables) | Presenters |
| Interfaces | `src/interfaces/mcp/`, `src/interfaces/cli/` | Delivery mechanisms (driving adapters) and their entrypoints `main.ts` | Apps |
| — | `src/container.ts` | Composition root (manual DI): builds infrastructure, use cases and the operation list | Main / DI |

### Dependency rule

```
interfaces ──▶ application ──▶ domain
infrastructure ──▶ application (ports, errors) ──▶ domain
container.ts wires everything; entrypoints are interfaces/{mcp,cli}/main.ts
```

- `domain` imports nothing outside `domain`: no I/O, no framework, no third-party code.
- `application` imports only `domain` and `application`. Use cases take their collaborators as a dependency object
  (`repository` for market data, portfolio and engagement; `gateway` = `ThndrAuthGateway`, `identity`,
  `sessions`, `flow` for identity).
- `infrastructure` implements domain repositories and application ports; it never imports `interfaces`.
- `interfaces` imports `application` and `domain` (plus zod and the MCP SDK); never `infrastructure`.
- Only `src/container.ts` and the entrypoints `src/interfaces/{mcp,cli}/main.ts` reference concrete infrastructure.
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
(`src/interfaces/presenters/error.ts`) turns any `DomainError` or `ApplicationError` into
`{ error: <code>, message }` (plus `status`/`upstreamCode` for upstream errors); anything else becomes
`INTERNAL_ERROR`. Input rejected by an operation's zod schema becomes `INVALID_INPUT`. MCP and CLI show the same
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

## Interfaces layer — one catalog, two delivery mechanisms

| Piece | Role |
| --- | --- |
| `catalog/operation.ts` | `Operation` / `defineOperation`: `name` (snake_case MCP tool name; CLI command = kebab-case via `commandName`), `title`, `description`, bounded `context`, CQRS `kind` (`query` \| `command`) with `destructive` / `idempotent` / `local` flags, zod `input`, optional CLI `positionals`, and a `handler` calling exactly one application service. |
| `catalog/<context>.ts` | `identityOperations()`, `marketDataOperations()`, `portfolioOperations()`, `engagementOperations()`; `catalog/dates.ts` parses date arguments as Cairo market days. |
| `catalog/execute.ts` | `executeOperation(operation, rawInput)`: strict zod validation → handler → `toView` / `presentError`. The **single execution path** of both apps. |
| `presenters/` | `view.ts` (`toView`), `error.ts` (`presentError`), `text.ts` (`renderText`, `renderTable` for the CLI). |
| `mcp/` | `server.ts` registers every operation as an MCP tool; annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) derive from `kind` and flags; results are JSON text plus `structuredContent`. `main.ts` = `thndr-mcp` binary (stdio). |
| `cli/` | `cli.ts` maps `thndr <command>` to an operation; `args.ts` derives `--kebab-case` flags from the zod schema (arrays repeated or comma-separated) and applies `positionals`; `help.ts` renders help from the descriptions; `login-command.ts` is the guided `thndr login` (a sequence of catalog login operations, no logic of its own). Output: `renderText`, or the exact MCP JSON with `--json`. Exit codes 0 ok, 1 operation error, 2 usage/invalid input. `main.ts` = `thndr` binary. |

A new capability is one application service plus one catalog entry; both apps expose it automatically. ADR 0012
requires a parity test asserting that both expose the same operation set and return identical JSON.
