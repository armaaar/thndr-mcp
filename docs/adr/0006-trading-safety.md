# 0006. Trading safety: read-only by default, two-step orders

- Status: Accepted
- Date: 2026-10-06

## Context

The IBKR MCP never places live orders: it creates *order instructions* that the human submits in IBKR's own UI.
Thndr has no equivalent "staged order" concept — an order request goes straight to the exchange. An LLM
hallucinating a quantity or symbol could therefore cause an irreversible trade.

## Decision

1. **Read-only by default.** Write tools that move money (`place_order`, `cancel_order`) are only registered
   when the user opts in with `THNDR_ENABLE_TRADING=true`. Watchlist/alert tools are non-financial and always on.
2. **Two-step placement.** `preview_order` validates the order against domain rules (tick size, lot size, price
   band, cash/position availability, market session) and returns a short-lived `confirmation_token` that binds
   the exact order parameters. `place_order` requires that token; any parameter change requires a new preview.
3. **Hard limits.** Optional `THNDR_MAX_ORDER_VALUE_EGP` caps the notional value of any single order.
4. **MCP annotations.** Write tools declare `destructiveHint: true`, `idempotentHint: false`, so clients prompt
   the human for approval.

## Consequences

- Safe default for people who only want analysis.
- One extra tool round-trip per order — acceptable for the safety it buys.
- Confirmation tokens are kept in memory only and expire (default 2 minutes).
