# 0006. Read-only trading scope

- Status: Accepted (documentation rule amended by [0019](0019-document-write-operations.md))
- Date: 2026-10-06

## Context

The IBKR MCP never sends live orders: at most it drafts an *instruction* that the human reviews and submits in
IBKR's own UI. Thndr has no equivalent staged-order concept, so any order request from this server would reach the
exchange directly, based on a model's interpretation of a conversation.

## Decision

thndr-mcp is **read-only with respect to money**. It exposes account, portfolio, order *history/status*, activity,
journal and market-data tools, plus non-financial list management (watchlists, price alerts). It does **not**
expose tools that place, modify or cancel orders, or move funds. Users act on insights in the official Thndr app.

Order-entry endpoints seen during reverse engineering are unimplemented. (They were left undocumented too; since
[ADR 0019](0019-document-write-operations.md) they are documented in clearly marked sections, still unimplemented.)

## Accepted risk

To be indistinguishable from ThndrX, the login requests the same token scopes the web client requests, which include
`order:write` and `funding:write`. The stored session could therefore trade if misused; no code path in this server
does so, and the session file is owner-only (ADR 0007). `login_import_session` passes browser cookies through the
model's context — prefer `npm run login` when possible.

## Consequences

- Safe default for analysis, monitoring and journaling use cases.
- Any future proposal to add order-entry would need a superseding ADR with a human-in-the-loop design.
- Read-only tools declare `readOnlyHint: true`; list-management tools declare accurate write hints.
