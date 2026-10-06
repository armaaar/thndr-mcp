# 0003. Domain-Driven Design with hexagonal architecture

- Status: Accepted
- Date: 2026-10-06

## Context

The Thndr API is private and unstable. If its payload shapes leak throughout the code base, every upstream change
becomes a shotgun surgery. We also want the trading rules (EGX tick sizes, order validation, safety checks) to be
testable without any network.

## Decision

We will structure the code as layers following DDD tactical patterns and ports & adapters:

```
src/
  domain/          Pure model: entities, value objects, aggregates, domain services, domain errors.
                   No I/O, no framework, no third-party imports.
  application/     Use cases (one class per use case) orchestrating the domain through ports.
    ports/         Interfaces the application needs (gateways, session store, clock, logger).
  infrastructure/  Adapters implementing ports:
    thndr/         Anti-corruption layer: HTTP client, DTOs (wire format) and mappers to the domain.
    firebase/      Firebase Identity Toolkit REST client.
    persistence/   File-based session store.
  interface/       Driving adapters: MCP tools (zod schemas, presenters) and CLI commands.
  main.ts          Composition root (manual dependency injection).
```

Dependency rule: `interface → application → domain`, `infrastructure → application(ports) → domain`. Nothing
depends on `interface` or `infrastructure` except `main.ts`.

Bounded contexts (see `docs/domains/`): **Identity & Access**, **Market Data**, **Portfolio**
(account, wallet, positions, order history, activity, journal), and **Engagement** (watchlists, price alerts, notifications).

## Consequences

- Upstream API changes are absorbed in `infrastructure/thndr/*` mappers.
- Domain and application code is unit-testable with in-memory fakes of the ports.
- Slightly more files/indirection than a "call fetch in the tool handler" design — accepted for maintainability.
