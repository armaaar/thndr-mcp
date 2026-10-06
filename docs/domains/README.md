# Strategic design

thndr-mcp lets an LLM agent analyse the EGX market and a Thndr account holder's portfolio, safely and read-only
([ADR 0006](../adr/0006-trading-safety.md)). The model is split into four bounded contexts plus a small shared
kernel ([ADR 0003](../adr/0003-ddd-hexagonal-architecture.md)).

## Subdomains

| Type | Subdomain | Why |
| --- | --- | --- |
| **Core** | Market analysis | Search, quotes, history, depth, tape and screening are what make the server useful to an agent. |
| **Core** | Portfolio insight | Cash, positions, order history, realized returns and trading-journal metrics — analysis of the user's own trading. |
| **Supporting** | Engagement | Watchlists, price alerts and notifications: useful list management, but not a differentiator. |
| **Generic** | Identity | Getting and keeping a Thndr session. Hard because it is interactive (phone approval), but not business logic. |

## Bounded contexts

| Context | Responsibility | Domain | Application | Port(s) | Doc |
| --- | --- | --- | --- | --- | --- |
| Identity & Access | Interactive login, device approval, token refresh, session persistence | `src/domain/identity/` | `src/application/identity/` | `ports/identity.ts`, `ports/access-token-provider.ts` | [identity-and-access.md](identity-and-access.md) |
| Market Data | Instruments, quotes, candles, order book, tape, market session, screening | `src/domain/market-data/` | `src/application/market-data/` | `ports/market-data.ts` | [market-data.md](market-data.md) |
| Portfolio | Account summary, positions, sellable quantity, orders (read-only), returns, journal, activity | `src/domain/portfolio/` | `src/application/portfolio/` | `ports/portfolio.ts` | [portfolio.md](portfolio.md) |
| Engagement | Watchlists, price alerts, notifications | `src/domain/engagement/` | `src/application/engagement/` | `ports/engagement.ts` | [engagement.md](engagement.md) |

### Relationships

- **Portfolio → Market Data** and **Engagement → Market Data** (customer/supplier): both use
  `InstrumentResolver` (and Engagement also `MarketQuotesCache`, via `InstrumentLabeler`) to translate between
  tickers and Thndr asset ids. They reuse Market Data value objects (`AssetId`, `Market`, `AssetClass`) rather than
  defining their own.
- **Every context → Identity & Access** (conformist on a port): Thndr HTTP calls get their bearer token from the
  `AccessTokenProvider` port; on a 401/403 the HTTP client calls `invalidate()` and retries once.
- **All contexts → Thndr API** through the anti-corruption layer (below).

See the context map in [docs/README.md](../README.md#context-map).

## Shared kernel — `src/domain/shared/`

Small, stable concepts every context may use. Changes here affect everyone, so keep it minimal.

| Module | Contents |
| --- | --- |
| `errors.ts` | `DomainError` (abstract, has `code`), `ValidationError` (`VALIDATION_ERROR`), `BusinessRuleViolation` (custom code). |
| `guards.ts` | `assertFiniteNumber`, `assertPositive`, `assertPositiveInteger`, `assertNonEmpty`, `roundTo` (float-safe rounding). |
| `money.ts` | `Money` value object (amount rounded to 4 decimals, currency `EGP` or `USD`, same-currency arithmetic). |
| `ticker.ts` | `Ticker` value object: trimmed, upper-cased, `^[A-Z0-9][A-Z0-9._-]{0,14}$`. |

Application-level errors (`src/application/errors.ts`) are shared across contexts too: `NOT_AUTHENTICATED`,
`SESSION_EXPIRED`, `NOT_FOUND`, `UPSTREAM_ERROR`, `FEATURE_DISABLED`. The MCP layer turns any `DomainError` or
`ApplicationError` into `{ error: <code>, message }` (plus `status`/`upstreamCode` for upstream errors); anything
else becomes `INTERNAL_ERROR`.

## Anti-corruption layer — `src/infrastructure/thndr/`

Thndr has no public API; we act as a browser-equivalent client of ThndrX
([ADR 0004](../adr/0004-reverse-engineer-thndrx-web-client.md)). Its payloads are snake_case, loosely typed and
may change without notice, so they are quarantined here:

| Piece | Role |
| --- | --- |
| `http-client.ts` | `ThndrHttpClient`: adds `Authorization: Bearer`, `x-thndrx-runtime-version`, `X-Language`, `X-Correlation-ID`; retries once after 401/403 with a refreshed token; maps non-2xx to `UpstreamError` (extracting message/code from FastAPI, Next.js and other error shapes). |
| `krakend.ts` | `assertNoKrakendError`: the KrakenD gateway (`/krakend-thndr-x`) answers 200 with an `error_*` key when a backend fails; this turns it into an `UpstreamError`. |
| `dto/` | Wire types (`market-data.ts`, `portfolio.ts`) — the only place snake_case field names live. |
| `mappers/` | Pure DTO → domain functions. Malformed rows are skipped (`mapRows`, `tolerant`), mandatory fields missing → `UpstreamError`. |
| `wire.ts` | Decoding helpers: timestamps (epoch s/ms/ISO), numbers from formatted strings, JWT `exp`, `Set-Cookie`. |
| `auth-gateway.ts`, `market-data-gateway.ts`, `portfolio-gateway.ts` | Adapters implementing the application ports. |

Other adapters: `src/infrastructure/firebase/` (Firebase Auth via the official SDK with file-backed persistence,
[ADR 0010](../adr/0010-prefer-official-sdks.md)), `src/infrastructure/persistence/` (session file, mode `0600`),
`src/infrastructure/logging/` (redacting stderr logger, [ADR 0009](../adr/0009-stdio-transport-and-logging.md)).

## Layering rules

```
interface → application → domain
infrastructure → application (ports) → domain
composition.ts wires concrete adapters (composition root); main.ts is the entrypoint
```

- `domain` imports nothing outside `domain`: no I/O, no framework, no third-party code.
- `application` imports only `domain` and `application`. It defines **ports** (interfaces) in
  `src/application/ports/`; use cases have an `execute(input)` method.
- Thndr wire formats stay inside `src/infrastructure/thndr/`.
- Value objects are immutable (`Object.freeze`) and validate in their static factory (`X.of(...)`); entity-like
  read models are built by `createX(...)` factories that validate and derive fields.
- Nothing depends on `interface` or `infrastructure` except the composition root.
- Nothing writes to stdout (it is the MCP channel). Tokens, cookies and the session file are never logged.
