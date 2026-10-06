# 0015. Five-layer Clean Architecture, CQS and an enforced context map

- Status: Accepted
- Date: 2026-10-06
- Supersedes: [0011](0011-ddd-layered-architecture.md) (layout)

## Context

ADR 0011 grouped repositories and data sources under one `infrastructure/` folder, and its bounded-context rules
existed only on paper. Commands returned read models, so they doubled as queries. The Portfolio and Engagement domains
imported Market Data's domain types directly. We want five explicit layers, Command–Query Separation and bounded
contexts with rules a test can check.

## Decision

### Five layers (dependencies point inward)

| # | Layer | Folder | Contents | May import |
| --- | --- | --- | --- | --- |
| 1 | Domain | `domain/` | Entities, value objects, aggregates, repository interfaces, shared kernel | `domain` only, no packages |
| 2 | Application | `application/` | Use cases (`Query` / `Command`), application services, ports | `domain`, `zod` |
| 3 | Repositories | `repositories/` | Implementations of domain repositories and application gateways; translators (anti-corruption layer) | `data-sources`, `application`, `domain` |
| 4 | Data sources | `data-sources/` | Raw clients for external systems: Thndr HTTP + wire DTOs, Firebase SDK, session file, stderr logger | `application` ports and errors only |
| 5 | Presentation | `presentation/` | Presenters and the two apps (MCP server, CLI) | `application`, shared-kernel errors |

`container.ts`, `config.ts`, `version.ts` and the entrypoints `presentation/{mcp,cli}/main.ts` form the composition root and may wire
every layer.

### Command–Query Separation

- **Query** use cases return data and have no observable side effect on domain state. Caching, instrument-lookup
  memoisation and transparent token refresh are infrastructure effects and are allowed.
- **Command** use cases change state and return only a flat **receipt**: ids they created, flags, and a message for the
  user, never a read model. `Command<Input, Output extends Receipt>` enforces this in the type system (a receipt holds
  only primitives or arrays of primitives). To observe the new state the caller runs the matching query, e.g.
  `create_watchlist` → `{ id, name, instrumentIds }`, then `get_watchlist`.
- Use cases never call other use cases. Logic two use cases share lives in an application service
  (`application/<context>/services/`).

### Bounded contexts and context map

| Context | Role | Upstream dependencies |
| --- | --- | --- |
| Identity & Access | Generic subdomain: login, device approval, session | none (consumed by repositories through the `AccessTokenProvider` port) |
| Market Data | Core, upstream **supplier** (Open Host Service: `application/market-data/services/*` and its domain types as published language) | none |
| Portfolio | Core, **customer** of Market Data | Market Data |
| Engagement | Supporting, **customer** of Market Data | Market Data |

- **Shared Kernel** (`domain/shared-kernel/`): `Money`, `Ticker`, `AssetId`, `Market`, domain errors and guards. It is
  shared by every context and depends on nothing.
- No context depends on Portfolio or Engagement. Portfolio and Engagement never depend on each other or on Identity.

### Enforcement

`src/__tests__/architecture.test.ts` turns these rules into build failures:

- the layer matrix;
- allowed packages per layer;
- the context map, including published-interface-only access;
- the shared kernel's independence;
- one `Query`/`Command` per file in `queries/`/`commands/`;
- no use case importing another;
- no use cases in presentation.

## Consequences

- The layers and the context map are visible in the tree and checked on every test run.
- Clients may need one extra query after a command to see the new state. That is the deliberate CQS trade-off.
- Data sources and presentation stay unaware of the domain beyond the shared kernel's errors, so external SDKs and
  delivery mechanisms stay swappable.
