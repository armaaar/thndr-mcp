# 0009. stdio transport and logging to stderr

- Status: Accepted
- Date: 2026-10-06

## Context

MCP clients (Claude Code, Claude Desktop) launch local servers over stdio. Anything written to stdout that is not
a JSON-RPC frame corrupts the protocol. The server also handles bearer tokens that must never be printed.

## Decision

- Use `StdioServerTransport`. All diagnostics go through a `Logger` port whose adapter writes to **stderr** only.
- The logger redacts values of keys matching `token|authorization|password|cookie|secret|refresh` and any string
  that looks like a JWT.
- `console.log` is banned in `src/` (lint rule `noConsole`).

## Consequences

- Safe to run under any MCP client; logs remain visible in the client's server log.
