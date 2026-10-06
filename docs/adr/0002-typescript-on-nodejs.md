# 0002. TypeScript on Node.js

- Status: Accepted — module resolution and build refined by [0014](0014-extensionless-imports-and-bundled-build.md)
- Date: 2026-10-06

## Context

The official MCP SDK is most mature in TypeScript. The ThndrX web client we reverse-engineer is itself a
TypeScript/Next.js application, so its wire types translate directly. Python was an acceptable alternative.

## Decision

We will implement the server in strict TypeScript (ESM, `NodeNext`), targeting Node.js ≥ 20 so that the global
`fetch` API is available and no HTTP library is needed. Tooling:

- `@modelcontextprotocol/sdk` for the MCP server, `zod` for tool input/output schemas.
- `vitest` + `@vitest/coverage-v8` for tests and coverage.
- `biome` for linting and formatting (one fast tool instead of ESLint + Prettier).
- `tsx` for running TypeScript during development.

## Consequences

- Zero runtime dependencies beyond the MCP SDK and zod.
- `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` catch many mapping mistakes at compile time,
  which matters when parsing loosely-typed reverse-engineered payloads.
