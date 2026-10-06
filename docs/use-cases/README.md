# Use cases and operations

Every capability is declared once as an **operation** in the command & query catalog (`src/interfaces/catalog/<context>.ts`,
`defineOperation`), and each operation calls exactly one use-case class (application service). Both delivery
mechanisms are generated from that catalog and run the **same** operation through the shared
`executeOperation(operation, rawInput)` — same zod validation, same use case, same presenters
([ADR 0012](../adr/0012-shared-operation-catalog.md)):

- **MCP** (`thndr-mcp`): the operation `name` is the tool name. Annotations derive from the CQRS kind: queries are
  `readOnlyHint`; commands carry `destructiveHint` / `idempotentHint` from their flags. Results are JSON plus
  `structuredContent`.
- **CLI** (`thndr`): the command is the kebab-case form of the tool name (`get_price_history` →
  `thndr get-price-history`). Every input field is a `--kebab-case` flag (`sort_by` → `--sort-by`; arrays may be
  repeated or comma-separated; booleans are bare flags). Some operations also take **positional arguments**, shown
  as `<…>` below in catalog order; a trailing `<x…>` collects all remaining arguments into an array. Output is a
  human-readable rendering of the same view, or the exact MCP JSON with `--json`. Exit codes: `0` ok, `1`
  operation error, `2` invalid usage or input. `thndr help [command]` and `thndr --version` are not operations.
- **`thndr login`** is a CLI-only guided composite of the login operations (`auth_status` → `login_start` →
  `login_verify_code` or `login_request_approval` → `login_complete`), run step by step through `executeOperation`;
  it adds no logic. See [identity-and-access.md](identity-and-access.md).

Tool names mirror the IBKR MCP where Thndr has an equivalent ([ADR 0008](../adr/0008-ibkr-mcp-as-reference.md)).
Thndr hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`,
`web` = `https://x.thndr.app/api`.

Errors (presented by `presentError`, identical in MCP and CLI) come back as `{ "error": <code>, "message": … }` —
with `isError: true` over MCP; the CLI prints `Error [<code>]: <message>` (or that JSON with `--json`) on stderr and
exits 1 (2 for `INVALID_INPUT`). Common codes:
`INVALID_INPUT` (rejected by the operation's zod schema), `VALIDATION_ERROR` (rejected by the domain),
`NOT_AUTHENTICATED`, `SESSION_EXPIRED`, `NOT_FOUND`, `UPSTREAM_ERROR` (with `status` / `upstreamCode` when known),
business-rule codes such as `LOGIN_NOT_STARTED`, and `INTERNAL_ERROR` for anything unexpected.

## Identity & Access — [details](identity-and-access.md)

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `auth_status` | `thndr auth-status` | `GetAuthStatus` | — (local session + Firebase) | — |
| `login_start` | `thndr login-start <email>` | `StartLogin` | `POST prod /auth-service/v2/users/email-code` | — |
| `login_verify_code` | `thndr login-verify-code <code>` | `VerifyLoginCode` (→ `RequestDeviceApproval`) | `POST prod /auth-service/v2/users/login`, Firebase `signInWithCustomToken`, `POST prod /auth-service/tokens/request` | — |
| `login_request_approval` | `thndr login-request-approval` | `RequestDeviceApproval` | `POST prod /auth-service/tokens/request` | — |
| `login_complete` | `thndr login-complete` | `CompleteLogin` | `POST prod /auth-service/tokens/request/{id}/status` (polled), `POST web /auth/login` | — |
| `login_import_session` | `thndr login-import-session <cookie_header>` | `ImportSession` | `POST web /auth/refresh` | — |
| `logout` | `thndr logout` | `Logout` | `DELETE web /auth/logout` | — |
| — (CLI only) | `thndr login` | guided composite: `GetAuthStatus` → `StartLogin` → `VerifyLoginCode` / `RequestDeviceApproval` → `CompleteLogin` | as the steps it runs | — |

All authenticated calls of the other contexts may additionally trigger `POST web /auth/refresh` through
`SessionTokenProvider`.

## Market Data — [details](market-data.md)

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `search_instruments` | `thndr search-instruments <query>` | `SearchInstruments` | `GET prod /assets-service/assets/search` | `search_contracts` |
| `get_instrument_details` | `thndr get-instrument-details <symbol>` | `GetInstrumentDetails` | (resolve) + `GET prod /assets-service/assets/{id}` | `search_contracts` (contract details) |
| `get_price_snapshot` | `thndr get-price-snapshot <symbols…>` | `GetPriceSnapshot` | (resolve) + `GET prod /assets-service/assets/marketwatch` | `get_price_snapshot` |
| `get_price_history` | `thndr get-price-history <symbol>` | `GetPriceHistory` | (resolve) + `GET krakend /feed/advanced-charts/v2/{id}/trades` | `get_price_history` |
| `get_market_depth` | `thndr get-market-depth <symbol>` | `GetMarketDepth` | (resolve) + `GET prod /assets-service/market-depth/{id}` | — (not in IBKR MCP) |
| `get_recent_trades` | `thndr get-recent-trades <symbol>` | `GetRecentTrades` | (resolve) + `GET prod /assets-service/market-depth/v3/trades-book/{id}` | — |
| `get_market_status` | `thndr get-market-status` | `GetMarketStatus` | `GET prod /market-service/markets/status`, `/markets/hours`, `GET prod /assets-service/assets/market-indicators` | — (market clock) |
| `screen_market` | `thndr screen-market` | `ScreenMarket` | `GET prod /assets-service/assets/marketwatch` | — |

"(resolve)" = `InstrumentResolver`: cache, else `GET /assets-service/assets/search` (ticker) or
`GET /assets-service/assets/{id}` (asset id).

## Portfolio — [details](portfolio.md)

All read-only ([ADR 0006](../adr/0006-trading-safety.md)).

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `get_account_summary` | `thndr get-account-summary` | `GetAccountSummary` | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_summary`, `get_account_balances` |
| `get_account_positions` | `thndr get-account-positions` | `GetPositions` | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_positions` |
| `get_position` | `thndr get-position <symbol>` | `GetPosition` | (resolve) + `GET krakend /portfolio/v1/position/{id}`, optionally `GET prod /market-service/accounts/positions/blocked-quantities/{id}` | `get_account_positions` |
| `get_account_orders` | `thndr get-account-orders` | `ListOrders` | `GET prod /market-service/v3/orders` (+ resolve when filtered by symbol) | `get_account_orders` |
| `get_realized_returns` | `thndr get-realized-returns` | `GetRealizedReturns` | `GET prod /market-service/realized-returns`, `GET prod /market-service/realized-returns/chart/{interval}` | `get_pa_performance_all_periods` (closest) |
| `get_closed_trades` | `thndr get-closed-trades` | `GetClosedTrades` | `GET prod /market-service/trading-journals/full-trades` | `get_account_trades` |
| `get_sell_journal` | `thndr get-sell-journal` | `GetSellJournal` | `GET krakend /trading-journals/v1/grouped-sells` | `get_account_trades` |
| `get_trading_metrics` | `thndr get-trading-metrics` | `GetTradingMetrics` | `GET krakend /trading-journals/v1/trading-metrics` (+ resolve tickers) | — |
| `get_account_activity` | `thndr get-account-activity` | `ListAccountActivity` | `GET prod /funding-service/account-activities` | `get_account_trades` (activity) |

Not provided by design: `create_order_instruction`, `delete_order_instruction` and any fund movement.

## Engagement — [details](engagement.md)

| MCP tool | CLI command | Use case |
| --- | --- | --- |
| `get_watchlists` | `thndr get-watchlists` | `GetWatchlists` |
| `get_watchlist` | `thndr get-watchlist <id>` | `GetWatchlist` |
| `create_watchlist` | `thndr create-watchlist <name> <symbols…>` | `CreateWatchlist` |
| `edit_watchlist` | `thndr edit-watchlist <id>` | `EditWatchlist` |
| `delete_watchlist` | `thndr delete-watchlist <id>` | `DeleteWatchlist` |
| `get_alerts` | `thndr get-alerts` | `GetAlerts` |
| `get_alert` | `thndr get-alert <id>` | `GetAlert` |
| `create_alert` | `thndr create-alert <symbol> <price>` | `CreateAlert` |
| `update_alert` | `thndr update-alert <id>` | `UpdateAlert` |
| `delete_alert` | `thndr delete-alert <id>` | `DeleteAlert` |
| `get_notifications` | `thndr get-notifications` | `GetNotifications` |
| `mark_notifications_read` | `thndr mark-notifications-read <ids…>` | `MarkNotificationsRead` |

Thndr endpoints are documented per use case in [engagement.md](engagement.md). The watchlist and alert names mirror
the IBKR MCP (`get_watchlists`, `create_watchlist`, `get_alerts`, `create_alert`, …).
