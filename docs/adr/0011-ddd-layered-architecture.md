# 0011. DDD layered architecture (refines 0003)

- Status: Accepted
- Date: 2026-10-06
- Refines: [0003](0003-ddd-hexagonal-architecture.md) (directory layout and vocabulary)

## Context

The project has two delivery mechanisms (MCP and CLI, ADR 0012). We want layer names a DDD / Clean Architecture
practitioner recognises at a glance, and a dependency rule that is obvious from the tree. The layout follows the
four-layer variant of the `clean-ddd-hexagonal` skill (`.claude/skills/clean-ddd-hexagonal/references/LAYERS.md`).

## Decision

| Layer | Folder | Contains (DDD building blocks) |
| --- | --- | --- |
| Domain | `domain/<context>/` | Entities, value objects, aggregates, domain services, **repository interfaces** (`repository.ts`) |
| Domain | `domain/shared-kernel/` | **Shared Kernel**: `Money`, `Ticker`, domain errors and guards shared by every bounded context |
| Application | `application/use-case.ts` | Abstract `UseCase`, `Query` and `Command` base classes (ADR 0012) |
| Application | `application/<context>/commands/`, `queries/` | **Use cases** (application services), one class per file |
| Application | `application/<context>/services/` | Application services the use cases share (`InstrumentResolver`, `MarketQuotesCache`, `SessionTokenProvider`, `InstrumentLabeler`) |
| Application | `application/ports/` | Driven ports that are not repositories: `Clock`, `Logger`, `AccessTokenProvider`, `ThndrAuthGateway`, `IdentityProvider` |
| Infrastructure | `infrastructure/repositories/` | Repository implementations (`thndr/`, `local/`, `memory/`) and **translators** (`thndr/translators/`), which form the **anti-corruption layer** |
| Infrastructure | `infrastructure/data-sources/` | Raw access to external systems in *their* language: Thndr HTTP client and wire DTOs, Firebase SDK, session file |
| Infrastructure | `infrastructure/logging/` | Redacting stderr logger |
| Presentation | `presentation/presenters/` | View models (`toView`), error presentation, terminal text, `runAndPresent` |
| Presentation | `presentation/mcp/`, `presentation/cli/` | Driving adapters (delivery mechanisms) and their entrypoints |
| — | `container.ts` | Composition root (manual dependency injection) |

Dependency rule (inner layers never import outer ones):

```
presentation ──▶ application ──▶ domain
infrastructure ──▶ application (ports, errors) ──▶ domain
container.ts wires everything; entrypoints: presentation/mcp/main.ts, presentation/cli/main.ts
```

Repository interfaces live in the domain, which owns the abstraction of its collections. Services the domain does not
care about (auth gateway, identity provider, clock, logger) are application ports.

## Consequences

- Each folder name states its DDD role. The shared kernel is explicit and small.
- Thndr's wire format can only appear in `infrastructure/data-sources/thndr/dto` and the translators.
- A third delivery mechanism (e.g. HTTP) would only add a folder under `presentation/`.
