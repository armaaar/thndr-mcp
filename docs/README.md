# thndr-mcp documentation

thndr-mcp is a community, **unofficial**, read-only (with respect to money) MCP server **and CLI** for the
[Thndr](https://thndr.app) broker on the Egyptian Exchange (EGX). It is built with Domain-Driven Design in Evans'
four layers ([ADR 0003](adr/0003-ddd-hexagonal-architecture.md), refined by
[ADR 0011](adr/0011-ddd-layered-architecture.md)). Both delivery mechanisms — the `thndr-mcp` MCP server and the
`thndr` CLI — are generated from one command & query catalog and run the same operations
([ADR 0012](adr/0012-shared-operation-catalog.md)), sharing one session file
([ADR 0013](adr/0013-persisted-login-flow-and-shared-session.md)).

## Architecture Decision Records — [`adr/`](adr/README.md)

| ADR | Summary |
| --- | --- |
| [0001](adr/0001-record-architecture-decisions.md) | Decisions are recorded as numbered, immutable ADRs. |
| [0002](adr/0002-typescript-on-nodejs.md) | Strict TypeScript on Node.js ≥ 20, MCP SDK + zod, Vitest, Biome. |
| [0003](adr/0003-ddd-hexagonal-architecture.md) | DDD layers (domain / application / infrastructure / interface) and the four bounded contexts; layout refined by 0011. |
| [0004](adr/0004-reverse-engineer-thndrx-web-client.md) | The ThndrX web client (`x.thndr.app`) is the source of truth for the API. |
| [0005](adr/0005-testing-strategy.md) | No real network in tests; ≥ 95 % coverage gate. |
| [0006](adr/0006-trading-safety.md) | Read-only scope: no order entry, no fund movement. |
| [0007](adr/0007-authentication-and-session.md) | Email OTP + phone approval login, token lifecycle, session file. |
| [0008](adr/0008-ibkr-mcp-as-reference.md) | Tool names mirror the Interactive Brokers MCP where possible. |
| [0009](adr/0009-stdio-transport-and-logging.md) | stdio transport; logs go to stderr, redacted. |
| [0010](adr/0010-prefer-official-sdks.md) | Official SDKs (Firebase Auth, MCP) over hand-rolled HTTP. |
| [0011](adr/0011-ddd-layered-architecture.md) | DDD layered layout: domain (with repository interfaces, shared kernel), application, infrastructure (repositories + translators, data sources), interfaces (catalog, presenters, MCP, CLI); `container.ts`. |
| [0012](adr/0012-shared-operation-catalog.md) | One operation catalog for MCP and CLI; single `executeOperation` path; CLI commands are kebab-case tool names. |
| [0013](adr/0013-persisted-login-flow-and-shared-session.md) | `LoginFlowRepository` persists the pending login; uncached session file shared by MCP and CLI. |

## Domains — [`domains/`](domains/README.md)

| Document | Summary |
| --- | --- |
| [Strategic design](domains/README.md) | Subdomains, bounded contexts, layers and dependency rule, shared kernel, anti-corruption layer, interfaces (catalog, presenters, MCP, CLI). |
| [Identity & Access](domains/identity-and-access.md) | Login flow (persisted), device approval, tokens, the session shared by MCP and CLI. |
| [Market Data](domains/market-data.md) | Instruments, quotes, candles, order book, tape, market session, screening. |
| [Portfolio](domains/portfolio.md) | Cash, positions, orders (history), returns, trading journal, account activity. |
| [Engagement](domains/engagement.md) | Watchlists, price alerts, notifications. |

## Use cases — [`use-cases/`](use-cases/README.md)

| Document | Summary |
| --- | --- |
| [Operation catalogue](use-cases/README.md) | Every operation: MCP tool + CLI command → use case → bounded context → Thndr endpoint → IBKR equivalent. |
| [Identity & Access](use-cases/identity-and-access.md) | `auth_status`, the 3-step login (and guided `thndr login`), re-approval, session import, logout. |
| [Market Data](use-cases/market-data.md) | Search, details, snapshot, history, depth, tape, market status, screener. |
| [Portfolio](use-cases/portfolio.md) | Account summary, positions, orders, returns, journal, metrics, activity. |
| [Engagement](use-cases/engagement.md) | Watchlist, price-alert and notification operations. |

## Reverse-engineered Thndr API — [`api/`](api/)

| Document | Summary |
| --- | --- |
| [auth.md](api/auth.md) | Firebase identity, device-approval 2FA, full-access token exchange, refresh and logout. |
| [market-data.md](api/market-data.md) | Assets, marketwatch, charts/candles, market depth, trades book, watchlists, screeners, price alerts, notifications. |
| [trading-and-portfolio.md](api/trading-and-portfolio.md) | Wallet and portfolio, positions, orders, realized returns, trading journal, account activity, market status. |
| [endpoints.generated.md](api/endpoints.generated.md) | Generated list of base URLs and paths found in the ThndrX bundle (`npm run sync:api`); do not edit. |

## Context map

```mermaid
flowchart LR
    LLM["MCP client / LLM agent"]
    USER["Terminal user / script"]

    subgraph Server["thndr-mcp"]
        direction LR
        MCP["MCP server<br/>src/interfaces/mcp"]
        CLI["CLI thndr<br/>src/interfaces/cli"]
        CAT["Operation catalog<br/>src/interfaces/catalog<br/>executeOperation"]
        IA["Identity & Access<br/>(generic)<br/>AccessTokenProvider"]
        MD["Market Data<br/>(core)<br/>InstrumentResolver"]
        PF["Portfolio<br/>(core)"]
        EN["Engagement<br/>(supporting)"]
        SK[["Shared kernel<br/>src/domain/shared-kernel<br/>Money · Ticker · errors · guards"]]
        ACL["Anti-corruption layer<br/>infrastructure/repositories/thndr/translators<br/>+ data-sources/thndr/dto"]
        SF[("Session file<br/>data-sources/local")]
    end

    THNDR[("Thndr API<br/>prod.thndr.app<br/>x.thndr.app/api")]
    FB[("Firebase Auth<br/>project thndr-api")]

    LLM --> MCP
    USER --> CLI
    MCP & CLI --> CAT
    CAT --> IA & MD & PF & EN

    PF -- "Customer/Supplier:<br/>resolves tickers" --> MD
    EN -- "Customer/Supplier:<br/>resolves tickers" --> MD

    MD -. "bearer token" .-> IA
    PF -. "bearer token" .-> IA
    EN -. "bearer token" .-> IA

    IA & MD & PF & EN --- SK

    IA --> ACL
    MD --> ACL
    PF --> ACL
    EN --> ACL
    ACL --> THNDR
    IA -- "official SDK (ADR 0010)" --> FB
    IA -- "session + login flow (ADR 0013)" --> SF
```

- **Portfolio** and **Engagement** are downstream of **Market Data**: they use its `InstrumentResolver` to turn a
  ticker (`COMI`) or asset id into an instrument.
- Every Thndr HTTP call obtains its bearer token through Identity's `AccessTokenProvider` port
  (implemented by `SessionTokenProvider`).
- Thndr's wire formats never cross the anti-corruption layer; the domain only sees its own model.
- The MCP server and the CLI are thin adapters over the same catalog: every operation is validated, executed and
  presented by `executeOperation`, so the two cannot drift. They also share the session file, so logging in through
  either one logs in both.
