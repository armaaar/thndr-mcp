# Use cases and MCP tools

Each MCP tool (in `src/interface/mcp/*-tools.ts`) calls exactly one use-case class. Tool names mirror the IBKR
MCP where Thndr has an equivalent ([ADR 0008](../adr/0008-ibkr-mcp-as-reference.md)). Thndr hosts:
`prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`,
`web` = `https://x.thndr.app/api`.

Errors come back as `{ "error": <code>, "message": … }` with `isError: true`. Common codes:
`VALIDATION_ERROR`, `NOT_AUTHENTICATED`, `SESSION_EXPIRED`, `NOT_FOUND`, `UPSTREAM_ERROR` (with `status` /
`upstreamCode` when known), business-rule codes such as `LOGIN_NOT_STARTED`, and `INTERNAL_ERROR` for anything
unexpected.

## Identity & Access — [details](identity-and-access.md)

| Tool | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- |
| `auth_status` | `GetAuthStatus` | — (local session + Firebase) | — |
| `login_start` | `StartLogin` | `POST prod /auth-service/v2/users/email-code` | — |
| `login_verify_code` | `VerifyLoginCode` (→ `RequestDeviceApproval`) | `POST prod /auth-service/v2/users/login`, Firebase `signInWithCustomToken`, `POST prod /auth-service/tokens/request` | — |
| `login_request_approval` | `RequestDeviceApproval` | `POST prod /auth-service/tokens/request` | — |
| `login_complete` | `CompleteLogin` | `POST prod /auth-service/tokens/request/{id}/status` (polled), `POST web /auth/login` | — |
| `login_import_session` | `ImportSession` | `POST web /auth/refresh` | — |
| `logout` | `Logout` | `DELETE web /auth/logout` | — |

All authenticated calls of the other contexts may additionally trigger `POST web /auth/refresh` through
`SessionTokenProvider`.

## Market Data — [details](market-data.md)

| Tool | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- |
| `search_instruments` | `SearchInstruments` | `GET prod /assets-service/assets/search` | `search_contracts` |
| `get_instrument_details` | `GetInstrumentDetails` | (resolve) + `GET prod /assets-service/assets/{id}` | `search_contracts` (contract details) |
| `get_price_snapshot` | `GetPriceSnapshot` | (resolve) + `GET prod /assets-service/assets/marketwatch` | `get_price_snapshot` |
| `get_price_history` | `GetPriceHistory` | (resolve) + `GET krakend /feed/advanced-charts/v2/{id}/trades` | `get_price_history` |
| `get_market_depth` | `GetMarketDepth` | (resolve) + `GET prod /assets-service/market-depth/{id}` | — (not in IBKR MCP) |
| `get_recent_trades` | `GetRecentTrades` | (resolve) + `GET prod /assets-service/market-depth/v3/trades-book/{id}` | — |
| `get_market_status` | `GetMarketStatus` | `GET prod /market-service/markets/status`, `/markets/hours`, `GET prod /assets-service/assets/market-indicators` | — (market clock) |
| `screen_market` | `ScreenMarket` | `GET prod /assets-service/assets/marketwatch` | — |

"(resolve)" = `InstrumentResolver`: cache, else `GET /assets-service/assets/search` (ticker) or
`GET /assets-service/assets/{id}` (asset id).

## Portfolio — [details](portfolio.md)

All read-only ([ADR 0006](../adr/0006-trading-safety.md)).

| Tool | Use case | Thndr endpoint(s) | IBKR equivalent |
| --- | --- | --- | --- |
| `get_account_summary` | `GetAccountSummary` | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_summary`, `get_account_balances` |
| `get_account_positions` | `GetPositions` | `GET prod /market-service/accounts/wallet-and-portfolio` | `get_account_positions` |
| `get_position` | `GetPosition` | (resolve) + `GET krakend /portfolio/v1/position/{id}`, optionally `GET prod /market-service/accounts/positions/blocked-quantities/{id}` | `get_account_positions` |
| `get_account_orders` | `ListOrders` | `GET prod /market-service/v3/orders` (+ resolve when filtered by symbol) | `get_account_orders` |
| `get_realized_returns` | `GetRealizedReturns` | `GET prod /market-service/realized-returns`, `GET prod /market-service/realized-returns/chart/{interval}` | `get_pa_performance_all_periods` (closest) |
| `get_closed_trades` | `GetClosedTrades` | `GET prod /market-service/trading-journals/full-trades` | `get_account_trades` |
| `get_sell_journal` | `GetSellJournal` | `GET krakend /trading-journals/v1/grouped-sells` | `get_account_trades` |
| `get_trading_metrics` | `GetTradingMetrics` | `GET krakend /trading-journals/v1/trading-metrics` (+ resolve tickers) | — |
| `get_account_activity` | `ListAccountActivity` | `GET prod /funding-service/account-activities` | `get_account_trades` (activity) |

Not provided by design: `create_order_instruction`, `delete_order_instruction` and any fund movement.

## Engagement — [details](engagement.md)

Watchlist, price-alert and notification tools (`get_watchlists`, `get_watchlist`, `create_watchlist`,
`edit_watchlist`, `delete_watchlist`, `get_alerts`, `get_alert`, `create_alert`, `update_alert`, `delete_alert`,
and notification tools) are documented in [engagement.md](engagement.md). They mirror the IBKR MCP names.
