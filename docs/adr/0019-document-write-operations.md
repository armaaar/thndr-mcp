# 0019. Document write operations; implementing them stays out of scope

- Status: Accepted
- Date: 2026-10-06
- Amends: [0006](0006-trading-safety.md) (its "left undocumented" rule only; read-only scope stays)

## Context

ADR 0006 kept order-entry endpoints undocumented as well as unimplemented. The maintainer plans to add write features
later (with a human-in-the-loop design), and reverse engineering the mobile app (all markets) is the moment the
request shapes are visible. Rediscovering them later would repeat that work, and an undocumented endpoint is easier
to misuse by accident than a documented one marked as off-limits.

## Decision

We will **document** every write operation we find — order placement, modification and cancellation (all order types
and markets), fee and buying-power calculators, fund and IPO/rights subscriptions, deposits and withdrawals, savings
transfers, and profile or settings writes — with full request shapes, preconditions and the safety mechanisms the app
uses (confirmations, PIN/biometric, OTP, idempotency keys).

They live in their own sections, headed **"Write operations (documented, not implemented — ADR 0006)"**, in
`docs/api/*.md`. Implementation remains out of scope: thndr-mcp stays read-only with respect to money until a
superseding ADR defines a human-in-the-loop design for a specific operation.

## Consequences

- A future write feature starts from documented, live-reviewed request shapes.
- Docs contain endpoints that move money; the heading and ADR 0006 make clear they are not exposed by any tool, and
  the architecture and container stay free of them.
- Non-financial writes already implemented (watchlists, price alerts, notifications read state) are documented as
  before.
