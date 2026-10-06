# 0008. IBKR MCP as the reference tool surface

- Status: Accepted
- Date: 2026-10-06

## Context

The official Interactive Brokers MCP is a well-designed, LLM-tested tool surface for a brokerage. Reusing its
vocabulary makes thndr-mcp intuitive for users and models that already know it.

## Decision

We mirror IBKR's tool families and naming where Thndr has an equivalent capability:

| IBKR MCP tool                                         | thndr-mcp tool                                   |
| ----------------------------------------------------- | ------------------------------------------------ |
| `get_account_summary`, `get_account_balances`         | `get_account_summary`                            |
| `get_account_positions`                               | `get_account_positions`                          |
| `get_account_orders`                                  | `get_account_orders`                             |
| `get_account_trades`                                  | `get_account_trades`, `get_account_activity`     |
| `search_contracts`                                    | `search_instruments`                             |
| `get_price_snapshot`                                  | `get_price_snapshot`                             |
| `get_price_history`                                   | `get_price_history`                              |
| — (market depth not in IBKR MCP)                      | `get_market_depth`                               |
| — (market clock)                                      | `get_market_status`                              |
| `create_order_instruction`                            | `preview_order` + `place_order` (ADR 0006)       |
| `delete_order_instruction`                            | `cancel_order`                                   |
| `get_watchlists`, `get_watchlist`, `create_watchlist`, `edit_watchlist`, `delete_watchlist` | same names |
| `get_alerts`, `get_alert`, `create_alert`, `update_alert`, `delete_alert` | same names (price alerts)    |

IBKR-only concepts (options, futures, combos, themes, PortfolioAnalyst) are out of scope: EGX via Thndr is
cash-equities (plus funds) only. Session tools (`auth_status`, `login_start`, `login_complete`) are added because
Thndr authentication is interactive (ADR 0007).

## Consequences

- Familiar surface; the exact final list is documented in `docs/use-cases/`.
- Where Thndr exposes richer data (market depth, trading-journal metrics), we add tools rather than bend IBKR names.
