# 0014. Extensionless imports and a bundled build

- Status: Accepted
- Date: 2026-10-06
- Refines: [0002](0002-typescript-on-nodejs.md)

## Context

With `moduleResolution: NodeNext`, TypeScript requires relative imports to carry the *output* extension
(`import … from './money.js'` inside `money.ts`'s neighbours). Node's ESM loader resolves imports at runtime and
never sees `.ts` files. Readers found `.js` specifiers next to `.ts` files confusing.

## Decision

- Source files import each other **without extensions** (`from './money'`).
- TypeScript uses `module: ESNext` and `moduleResolution: Bundler`, with `noEmit`. `tsc` is only a type checker.
- The production build bundles the two entrypoints with **tsup** (esbuild) into `dist/thndr-mcp.js` (MCP server)
  and `dist/thndr.js` (CLI). npm dependencies stay external.
- Development, tests and skill scripts run TypeScript directly with `tsx` and Vitest, which resolve extensionless
  imports.

## Consequences

- Imports read naturally, and moving a file never needs extension fixes.
- `dist/` is a bundle rather than a 1:1 transpilation. Stack traces map back through source maps.
- A known low-severity esbuild advisory (development server on Windows) does not apply: we never run esbuild's
  server.
