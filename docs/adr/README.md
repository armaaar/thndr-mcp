# Architecture Decision Records

We record architecturally significant decisions using a lightweight
[MADR](https://adr.github.io/madr/)-style template (`template.md`). ADRs are immutable once accepted; a decision
is changed by adding a new ADR that supersedes the old one.

| #    | Title                                                                    | Status   |
| ---- | ------------------------------------------------------------------------ | -------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)   | Accepted |
| 0002 | [TypeScript on Node.js](0002-typescript-on-nodejs.md)                    | Accepted, build refined by 0014 |
| 0003 | [Domain-Driven Design with hexagonal architecture](0003-ddd-hexagonal-architecture.md) | Accepted, layout refined by 0011, use cases by 0012 |
| 0004 | [Reverse-engineer the ThndrX web client](0004-reverse-engineer-thndrx-web-client.md) | Accepted |
| 0005 | [Testing strategy and >95% coverage gate](0005-testing-strategy.md)      | Accepted |
| 0006 | [Read-only trading scope](0006-trading-safety.md) | Accepted |
| 0007 | [Authentication and session persistence](0007-authentication-and-session.md) | Accepted |
| 0008 | [IBKR MCP as the reference tool surface](0008-ibkr-mcp-as-reference.md)  | Accepted |
| 0009 | [stdio transport and logging to stderr](0009-stdio-transport-and-logging.md) | Accepted |
| 0010 | [Prefer official SDKs over hand-rolled API calls](0010-prefer-official-sdks.md) | Accepted |
| 0011 | [DDD layered architecture](0011-ddd-layered-architecture.md) | Superseded by 0015 |
| 0012 | [Self-describing use-case classes shared by MCP and CLI](0012-use-case-classes-shared-by-mcp-and-cli.md) | Accepted |
| 0013 | [Persisted login flow and shared session](0013-persisted-login-flow-and-shared-session.md) | Accepted |
| 0014 | [Extensionless imports and a bundled build](0014-extensionless-imports-and-bundled-build.md) | Accepted |
| 0015 | [Five-layer Clean Architecture, CQS and an enforced context map](0015-five-layer-clean-architecture-cqs-and-context-map.md) | Accepted |
