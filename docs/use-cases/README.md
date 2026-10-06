# Use cases

Every capability is one **use-case class** (application service) extending `Query` or `Command`
(`src/application/use-case.ts`), one class per file in `src/application/<context>/queries/` or `commands/`.
Command–Query Separation ([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)): a `Query`
returns data and has no observable side effect; a `Command` changes state and returns only a flat **receipt**
(`Receipt`: ids, flags, primitive values, a message — never a read model). To see the new state after a command, call
the matching query (e.g. `create_watchlist` → `get_watchlist`). Use cases never call each other; shared logic lives in
application services (`src/application/<context>/services/`). The class
owns its contract — `name`, `title`, `description`, bounded `context` and a zod `input` whose camelCase fields are
the `execute` parameters — and `run(rawInput)` validates untrusted input before calling `execute`. The composition
root (`src/container.ts`) returns the `useCases` list; both delivery mechanisms are generated from it and run every
use case through the same `runAndPresent(useCase, rawInput)` — same validation, same use case, same presenters
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)):

- **MCP** (`thndr-mcp`): the use case's `name` is the tool name and its camelCase input fields are the tool
  arguments (e.g. `{"timeoutSeconds": 60}`). Annotations derive from the class: a `Query` is `readOnlyHint`; a
  `Command` carries `destructiveHint` / `idempotentHint` from its flags; `local` use cases are not `openWorldHint`.
  Results are JSON plus `structuredContent`.
- **CLI** (`thndr`): the command is the kebab-case form of the tool name (`get_price_history` →
  `thndr get-price-history`). Every input field is a `--kebab-case` flag (`sortBy` → `--sort-by`; arrays may be
  repeated or comma-separated; booleans are bare flags). Some commands also take **positional arguments**
  (`CLI_POSITIONALS` in `src/presentation/cli/positionals.ts`), shown as `<…>` below in order; a trailing `<x…>`
  collects all remaining arguments into an array. Output is a human-readable rendering of the same view, or the
  exact MCP JSON with `--json`. Exit codes: `0` ok, `1` use-case error, `2` invalid usage or input.
  `thndr help [command]` and `thndr --version` are not use cases.
- **`thndr login`** is a CLI-only guided composite of the identity use cases (`auth_status` → `login_start` →
  `login_verify_code` or `login_request_approval` → `login_complete`), run step by step through `runAndPresent`
  (`src/presentation/cli/login-command.ts`); it adds no logic. See [identity-and-access.md](identity-and-access.md).

The "Use case" columns give the class and its file under `src/application/`.

Tool names mirror the IBKR MCP where Thndr has an equivalent ([ADR 0008](../adr/0008-ibkr-mcp-as-reference.md)).
Thndr hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`,
`web` = `https://x.thndr.app/api`.

Errors (presented by `presentError`, identical in MCP and CLI) come back as `{ "error": <code>, "message": … }` —
with `isError: true` over MCP; the CLI prints `Error [<code>]: <message>` (or that JSON with `--json`) on stderr and
exits 1 (2 for `INVALID_INPUT`). Common codes:
`INVALID_INPUT` (rejected by the use case's zod `input` contract in `UseCase.run`), `VALIDATION_ERROR` (rejected by the domain),
`NOT_AUTHENTICATED`, `SESSION_EXPIRED`, `NOT_FOUND`, `UPSTREAM_ERROR` (with `status` / `upstreamCode` when known),
business-rule codes such as `LOGIN_NOT_STARTED`, and `INTERNAL_ERROR` for anything unexpected.

## Identity & Access — [details](identity-and-access.md)

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `auth_status` | `thndr auth-status` | `GetAuthStatus` (`identity/queries/get-auth-status.ts`) | — (local session + Firebase) | — |
| `login_start` | `thndr login-start <email>` | `StartLogin` (`identity/commands/start-login.ts`) | `POST prod /auth-service/v2/users/email-code` | — |
| `login_verify_code` | `thndr login-verify-code <code>` | `VerifyLoginCode` (`identity/commands/verify-login-code.ts`) (→ `DeviceApprovalRequester` service, shared with `RequestDeviceApproval`) | `POST prod /auth-service/v2/users/login`, Firebase `signInWithCustomToken`, `POST prod /auth-service/tokens/request` | — |
| `login_request_approval` | `thndr login-request-approval` | `RequestDeviceApproval` (`identity/commands/request-device-approval.ts`) | `POST prod /auth-service/tokens/request` | — |
| `login_complete` | `thndr login-complete` | `CompleteLogin` (`identity/commands/complete-login.ts`) | `POST prod /auth-service/tokens/request/{id}/status` (polled), `POST web /auth/login` | — |
| `login_import_session` | `thndr login-import-session <cookieHeader>` | `ImportSession` (`identity/commands/import-session.ts`) | `POST web /auth/refresh` | — |
| `logout` | `thndr logout` | `Logout` (`identity/commands/logout.ts`) | `DELETE web /auth/logout` | — |
| — (CLI only) | `thndr login` | guided composite: `GetAuthStatus` → `StartLogin` → `VerifyLoginCode` / `RequestDeviceApproval` → `CompleteLogin` | as the steps it runs | — |

All authenticated calls of the other contexts may additionally trigger `POST web /auth/refresh` through
`SessionTokenProvider`.

## Market Data — [details](market-data.md)

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `search_instruments` | `thndr search-instruments <query>` | `SearchInstruments` (`market-data/queries/search-instruments.ts`) | `GET prod /assets-service/assets/search` | `search_contracts` |
| `get_instrument_details` | `thndr get-instrument-details <symbol>` | `GetInstrumentDetails` (`market-data/queries/get-instrument-details.ts`) | (resolve) + `GET prod /assets-service/assets/{id}` (+ index membership) | `search_contracts` (contract details) |
| `get_price_snapshot` | `thndr get-price-snapshot <symbols…>` | `GetPriceSnapshot` (`market-data/queries/get-price-snapshot.ts`) | (resolve) + `GET prod /assets-service/assets/marketwatch` | `get_price_snapshot` |
| `get_price_history` | `thndr get-price-history <symbol>` | `GetPriceHistory` (`market-data/queries/get-price-history.ts`) | (resolve) + `GET krakend /feed/advanced-charts/v2/{id}/trades` | `get_price_history` |
| `get_market_depth` | `thndr get-market-depth <symbol>` | `GetMarketDepth` (`market-data/queries/get-market-depth.ts`) | (resolve) + `GET prod /assets-service/market-depth/{id}` | — (not in IBKR MCP) |
| `get_recent_trades` | `thndr get-recent-trades <symbol>` | `GetRecentTrades` (`market-data/queries/get-recent-trades.ts`) | (resolve) + `GET prod /assets-service/market-depth/v3/trades-book/{id}` | — |
| `get_market_status` | `thndr get-market-status` | `GetMarketStatus` (`market-data/queries/get-market-status.ts`) | `GET prod /market-service/markets/status`, `/markets/hours`, `GET prod /assets-service/assets/market-indicators` | — (market clock) |
| `screen_market` | `thndr screen-market` | `ScreenMarket` (`market-data/queries/screen-market.ts`) | `GET prod /assets-service/assets/marketwatch` (+ index members, `GET prod /users-service/screeners/{id}` for `screenerId`) | — |
| `get_screeners` | `thndr get-screeners` | `GetScreeners` (`market-data/queries/get-screeners.ts`) | `GET prod /users-service/screeners` (+ ThndrX's built-in presets) | — |
| `get_index_constituents` | `thndr get-index-constituents <index>` | `GetIndexConstituents` (`market-data/queries/get-index-constituents.ts`) | `GET prod /assets-service/assets/marketwatch` + `GET prod /assets-service/assets/{indexId}` (`constituents`) | — |
| `get_peers` | `thndr get-peers <symbol>` | `GetPeers` (`market-data/queries/get-peers.ts`) | (resolve) + `GET prod /assets-service/assets/{id}/recommendations` + `GET prod /assets-service/assets/marketwatch` | `get_company_connections` (closest) |

"(resolve)" = `InstrumentResolver`: cache, else `GET /assets-service/assets/search` (ticker) or
`GET /assets-service/assets/{id}` (asset id). "Index members" = `IndexMembership`: the `INDX` marketwatch rows and
each index's `GET /assets-service/assets/{indexId}` (`constituents`), cached 6 h.

## Portfolio — [details](portfolio.md)

All read-only ([ADR 0006](../adr/0006-trading-safety.md)).

| MCP tool | CLI command | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- | --- |
| `get_account_summary` | `thndr get-account-summary` | `GetAccountSummary` (`portfolio/queries/get-account-summary.ts`) | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_summary`, `get_account_balances` |
| `get_account_positions` | `thndr get-account-positions` | `GetPositions` (`portfolio/queries/get-positions.ts`) | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_positions` |
| `get_position` | `thndr get-position <symbol>` | `GetPosition` (`portfolio/queries/get-position.ts`) | (resolve) + `GET krakend /portfolio/v1/position/{id}`, optionally `GET prod /market-service/accounts/positions/blocked-quantities/{id}` | `get_account_positions` |
| `get_account_orders` | `thndr get-account-orders` | `ListOrders` (`portfolio/queries/list-orders.ts`) | `GET prod /market-service/v3/orders` (+ resolve when filtered by symbol) | `get_account_orders` |
| `get_realized_returns` | `thndr get-realized-returns` | `GetRealizedReturns` (`portfolio/queries/get-realized-returns.ts`) | `GET prod /market-service/realized-returns`, `GET prod /market-service/realized-returns/chart/{interval}` | `get_pa_performance_all_periods` (closest) |
| `get_closed_trades` | `thndr get-closed-trades` | `GetClosedTrades` (`portfolio/queries/get-closed-trades.ts`) | `GET prod /market-service/trading-journals/full-trades` | `get_account_trades` |
| `get_sell_journal` | `thndr get-sell-journal` | `GetSellJournal` (`portfolio/queries/get-sell-journal.ts`) | `GET krakend /trading-journals/v1/grouped-sells` | `get_account_trades` |
| `get_trading_metrics` | `thndr get-trading-metrics` | `GetTradingMetrics` (`portfolio/queries/get-trading-metrics.ts`) | `GET krakend /trading-journals/v1/trading-metrics` (+ resolve tickers) | — |
| `get_account_activity` | `thndr get-account-activity` | `ListAccountActivity` (`portfolio/queries/list-account-activity.ts`) | `GET prod /funding-service/account-activities` | `get_account_trades` (activity) |

Not provided by design: `create_order_instruction`, `delete_order_instruction` and any fund movement.

## Engagement — [details](engagement.md)

| MCP tool | CLI command | Use case | IBKR equivalent |
| --- | --- | --- | --- |
| `get_watchlists` | `thndr get-watchlists` | `GetWatchlists` (`engagement/queries/get-watchlists.ts`) | `get_watchlists` |
| `get_watchlist` | `thndr get-watchlist <id>` | `GetWatchlist` (`engagement/queries/get-watchlist.ts`) | `get_watchlist` |
| `create_watchlist` | `thndr create-watchlist <name> <symbols…>` | `CreateWatchlist` (`engagement/commands/create-watchlist.ts`) | `create_watchlist` |
| `edit_watchlist` | `thndr edit-watchlist <id>` | `EditWatchlist` (`engagement/commands/edit-watchlist.ts`) | `edit_watchlist` |
| `delete_watchlist` | `thndr delete-watchlist <id>` | `DeleteWatchlist` (`engagement/commands/delete-watchlist.ts`) | `delete_watchlist` |
| `get_alerts` | `thndr get-alerts` | `GetAlerts` (`engagement/queries/get-alerts.ts`) | `get_alerts` |
| `get_alert` | `thndr get-alert <id>` | `GetAlert` (`engagement/queries/get-alert.ts`) | `get_alert` |
| `create_alert` | `thndr create-alert <symbol> <price>` | `CreateAlert` (`engagement/commands/create-alert.ts`) | `create_alert` |
| `update_alert` | `thndr update-alert <id>` | `UpdateAlert` (`engagement/commands/update-alert.ts`) | `update_alert` |
| `delete_alert` | `thndr delete-alert <id>` | `DeleteAlert` (`engagement/commands/delete-alert.ts`) | `delete_alert` |
| `get_notifications` | `thndr get-notifications` | `GetNotifications` (`engagement/queries/get-notifications.ts`) | — |
| `mark_notifications_read` | `thndr mark-notifications-read <ids…>` | `MarkNotificationsRead` (`engagement/commands/mark-notifications-read.ts`) | — |

Thndr endpoints are documented per use case in [engagement.md](engagement.md). The watchlist and alert names mirror
the IBKR MCP ([ADR 0008](../adr/0008-ibkr-mcp-as-reference.md)); notifications have no IBKR counterpart.
