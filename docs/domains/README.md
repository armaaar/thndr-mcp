# Strategic design

thndr-mcp lets an LLM agent analyse the EGX market and a Thndr account holder's portfolio, safely and read-only
([ADR 0006](../adr/0006-trading-safety.md)). The model is split into four bounded contexts plus a small shared
kernel ([ADR 0003](../adr/0003-ddd-hexagonal-architecture.md)), organised in five Clean Architecture layers with
Command–Query Separation and an enforced context map
([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)). The same use cases are offered to agents through an MCP
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

### Context map ([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md))

| Context | Role | Depends on |
| --- | --- | --- |
| Identity & Access | Generic subdomain, **independent** | no other context |
| Market Data | Core, upstream **supplier** — **Open Host Service**: `application/market-data/services/*` (`InstrumentResolver`, `MarketQuotesCache`) with its domain types (`src/domain/market-data/`) as the published language | no other context |
| Portfolio | Core, **customer** of Market Data | Market Data (published interface only) |
| Engagement | Supporting, **customer** of Market Data | Market Data (published interface only) |

- **Portfolio → Market Data** and **Engagement → Market Data** (customer/supplier): both use `InstrumentResolver`
  (and Engagement also `MarketQuotesCache`, via `InstrumentLabeler`) to translate between tickers and Thndr asset
  ids. They may import only Market Data's domain and `application/market-data/services/*`, never its use cases.
- **Nothing depends on Portfolio or Engagement**, and they never depend on each other or on Identity.
- **Shared Kernel** (`src/domain/shared-kernel/`): `AssetId`, `Market` (and `AssetClass`), `Money`, `Ticker`, errors
  and guards are shared by every context; the kernel depends on nothing.
- **Identity & Access is consumed through a port**, not as a context dependency: the Thndr HTTP client (a data
  source) gets its bearer token from the `AccessTokenProvider` application port; on a 401/403 it calls
  `invalidate()` and retries once.
- **All contexts → Thndr API** through the anti-corruption layer (below).

These rules are enforced by `src/__tests__/architecture.test.ts`. See also the diagram in
[docs/README.md](../README.md#context-map).

## Layers — [ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)

Five layers; dependencies point inward.

| # | Layer | Folder | Contains (DDD building blocks) | May import |
| --- | --- | --- | --- | --- |
| 1 | Domain | `src/domain/<context>/` | Entities, value objects, aggregates, domain services, **repository interfaces** (`repository.ts`) | `domain` only, no packages |
| 1 | Domain | `src/domain/shared-kernel/` | **Shared kernel**: `AssetId`, `Market`, `Money`, `Ticker`, domain errors, guards | itself only |
| 2 | Application | `src/application/use-case.ts` | Abstract `UseCase` and its CQS subclasses `Query` and `Command` (output constrained to a flat `Receipt`) ([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)) | `domain`, `zod` |
| 2 | Application | `src/application/<context>/queries/`, `commands/` | **Use cases**: one `Query` or `Command` subclass per file, owning its contract (`name`, `title`, `description`, `context`, zod `input`) and `execute`. Use cases never call each other | `domain`, `zod` |
| 2 | Application | `src/application/<context>/services/` | Application services shared by use cases: `InstrumentResolver`, `MarketQuotesCache` (Market Data's Open Host Service), `SessionTokenProvider`, `DeviceApprovalRequester`, `InstrumentLabeler`, `WatchlistReader` | `domain`, `zod` |
| 2 | Application | `src/application/ports/` | Ports that are not repositories: `Clock`, `Logger`, `AccessTokenProvider`, `ThndrAuthGateway`, `IdentityProvider` | `domain` |
| 2 | Application | `src/application/errors.ts`, `inputs.ts`, `paging.ts` | Application errors and reusable input fields (`marketInput`, `symbolInput`, `dateInput`, `pageInput`) shared by all contexts | `domain`, `zod` |
| 3 | Repositories | `src/repositories/` | Implementations of domain repositories and application gateways: `thndr/*-repository.ts` + `thndr/auth-gateway.ts`, `local/` (session file), `memory/` (tests); **translators** (anti-corruption layer) in `thndr/translators/` | `data-sources`, `application`, `domain`; no packages |
| 4 | Data sources | `src/data-sources/` | Raw access to external systems in *their* language: `thndr/` (HTTP client, KrakenD guard, wire DTOs), `firebase/` (official SDK), `local/session-file.ts`, `logging/` (redacting stderr logger, [ADR 0009](../adr/0009-stdio-transport-and-logging.md)) | `application/ports/` and `application/errors` only; `node:*`, `@firebase/*` |
| 5 | Presentation | `src/presentation/presenters/` | `toView` (view models), `presentError`, `renderText` (terminal tables), `runAndPresent` | `application`, shared-kernel errors; `zod`, `node:*`, MCP SDK |
| 5 | Presentation | `src/presentation/mcp/`, `src/presentation/cli/` | Delivery mechanisms (driving adapters) and their entrypoints `main.ts` | as above |
| — | `src/container.ts`, `src/config.ts` | Composition root (manual DI): builds data sources, repositories and application services, returns the `useCases` list | every layer |

### Dependency rule

```
presentation ──▶ application ──▶ domain
repositories ──▶ data-sources ──▶ application (ports, errors)
repositories ──▶ application, domain
container.ts / config.ts and presentation/{mcp,cli}/main.ts (composition root) wire everything
```

- `domain` imports nothing outside `domain`: no I/O, no framework, no third-party code.
- `application` imports only `domain` and `application` (plus zod, for input contracts only). Use cases take their
  collaborators as a dependency object (`repository` and `resolver` for market data, portfolio and engagement;
  `gateway` = `ThndrAuthGateway`, `identity`, `sessions`, `flow` for identity).
- **CQS**: a `Query` returns data and has no observable side effect on domain state (caching, lookup memoisation
  and transparent token refresh are allowed); a `Command` changes state and returns a flat `Receipt` (ids, flags,
  primitives or arrays of primitives, a message) — never a read model. To see the new state, run the matching query.
- `repositories` implement domain repositories and application ports on top of `data-sources`; they never import
  `presentation`.
- `data-sources` know nothing of the domain: they use only application ports and application errors.
- `presentation` imports `application` and, from the domain, only shared-kernel errors (plus zod, `node:*` and the
  MCP SDK); never `repositories` or `data-sources`. It contains no use cases.
- Only the composition root (`src/container.ts`, `src/config.ts`, `src/presentation/{mcp,cli}/main.ts`) references
  concrete repositories and data sources.
- All of the above, plus the context map and "one `Query`/`Command` per file, no use case importing another", are
  fitness functions in `src/__tests__/architecture.test.ts`.
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
| `asset-id.ts` | `AssetId` value object: Thndr's instrument identifier (a UUID, lower-cased). |
| `market.ts` | `Market` (`egypt` default, `us`) with `parseMarket` (aliases `egx`, `eg`, `usa`); `AssetClass` with `parseAssetClass`. |

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
may change without notice. Thndr's wire format may appear **only** in `src/data-sources/thndr/dto/`
and in the translators (`src/repositories/thndr/translators/`):

| Piece | Role |
| --- | --- |
| `data-sources/thndr/http-client.ts` | `ThndrHttpClient`: adds `Authorization: Bearer`, `x-thndrx-runtime-version`, `X-Language`, `X-Correlation-ID`; retries once after 401/403 with a refreshed token; maps non-2xx to `UpstreamError` (extracting message/code from FastAPI, Next.js and other error shapes). |
| `data-sources/thndr/krakend.ts` | `assertNoKrakendError`: the KrakenD gateway (`/krakend-thndr-x`) answers 200 with an `error_*` key when a backend fails; this turns it into an `UpstreamError`. |
| `data-sources/thndr/dto/` | Wire types (`market-data.ts`, `portfolio.ts`, `engagement.ts`) — the only place snake_case field names live. |
| `data-sources/thndr/wire.ts` | Decoding helpers: timestamps (epoch s/ms/ISO), numbers from formatted strings, JWT `exp`, `Set-Cookie`. |
| `repositories/thndr/translators/` | **The anti-corruption layer proper**: pure DTO → domain functions. Malformed rows are skipped (`mapRows`), mandatory fields missing → `UpstreamError`. |
| `repositories/thndr/market-data-repository.ts`, `portfolio-repository.ts`, `engagement-repository.ts` | `ThndrMarketDataRepository`, `ThndrPortfolioRepository`, `ThndrEngagementRepository`: implement the domain repositories (paths, params, translation). |
| `repositories/thndr/auth-gateway.ts` | `HttpThndrAuthGateway`: implements the `ThndrAuthGateway` application port. |

Other data sources and repositories: `src/data-sources/firebase/` (Firebase Auth via the official SDK with
file-backed persistence, [ADR 0010](../adr/0010-prefer-official-sdks.md)),
`src/data-sources/local/session-file.ts` (the shared session file, mode `0600`, uncached,
[ADR 0013](../adr/0013-persisted-login-flow-and-shared-session.md)) used by
`src/repositories/local/` (`FileSessionRepository`, `FileLoginFlowRepository`), and
`src/data-sources/logging/` (redacting stderr logger).

## Use cases and the presentation layer — one list, two delivery mechanisms

| Piece | Role |
| --- | --- |
| `application/use-case.ts` | `UseCase` (abstract): `name` (snake_case MCP tool name; CLI command = kebab-case), `title`, `description`, bounded `context`, zod `input` (camelCase fields = `execute` parameters), `local` flag, `execute(input)`, and `run(rawInput)`, which validates strictly (unknown fields rejected, defaults applied, `INVALID_INPUT` on failure) and then calls `execute`. `Query` (`kind = 'query'`) reads; `Command` (`kind = 'command'`) changes state, returns a flat `Receipt` (type-enforced) and adds the `destructive` / `idempotent` flags. |
| `application/<context>/{queries,commands}/<name>.ts` | One use-case class per file (e.g. `GetPriceHistory` in `market-data/queries/get-price-history.ts`). Use cases never import each other; shared logic lives in `services/` and in small modules next to them (`inputs.ts`, `paging.ts`, `journal-input.ts`). |
| `container.ts` | `compose(config)` returns `useCases: UseCase[]`, the application's published interface, in the order users see it. |
| `presentation/presenters/` | `view.ts` (`toView`), `error.ts` (`presentError`), `text.ts` (`renderText`, `renderTable` for the CLI), `outcome.ts` (`runAndPresent(useCase, rawInput)`: `useCase.run` → `toView` / `presentError`). The **single execution path** of both apps. |
| `presentation/mcp/` | `server.ts`: `registerUseCases` registers every use case as an MCP tool with its own name, title, description and `toolInputSchema` (advertises the strict contract, leaves validation to `UseCase.run`); `annotationsFor` derives `readOnlyHint`, `destructiveHint`, `idempotentHint` (`instanceof Command` + flags) and `openWorldHint` (`!local`). Results are JSON text plus `structuredContent`. `main.ts` = `thndr-mcp` binary (stdio). |
| `presentation/cli/` | `cli.ts` (`runCli`) maps `thndr <command>` to a use case; `args.ts` derives `--kebab-case` flags from the zod contract (arrays repeated or comma-separated); `positionals.ts` holds `CLI_POSITIONALS` (CLI-only positional arguments, keyed by use-case name), `commandName` and `flagName`; `help.ts` renders help from the contracts; `login-command.ts` is the guided `thndr login` (a sequence of identity use cases through `runAndPresent`, no logic of its own). Output: `renderText`, or the exact MCP JSON with `--json`. Exit codes 0 ok, 1 use-case error, 2 usage/invalid input. `main.ts` = `thndr` binary. |

A new capability is one new `Query` or `Command` subclass registered in `src/container.ts`; both apps expose it
automatically. `src/presentation/__tests__/parity.test.ts` asserts that both expose the same use cases and return identical
JSON for identical input.
