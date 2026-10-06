# thndr-mcp

An **unofficial, community** [Model Context Protocol](https://modelcontextprotocol.io) server for
[Thndr](https://thndr.app), the Egyptian Exchange (EGX) broker. Ask Claude about your portfolio, orders, the market,
price history, order books and your trading journal, and manage watchlists and price alerts.

> Thndr publishes no API. This project uses the private API of Thndr's own web platform
> [ThndrX](https://x.thndr.app), reverse-engineered from its public JavaScript (see [`docs/api`](docs/api)). It is
> not affiliated with or endorsed by Thndr. It may break when Thndr changes things. Use at your own risk.

**Read-only for money ([ADR 0006](docs/adr/0006-trading-safety.md)):** the server never places, modifies or cancels
orders and never moves funds. Trade in the Thndr app.

## Requirements

- Node.js ≥ 20
- A Thndr account with the **Thndr mobile app logged in on your phone** (needed to approve logins)
- Access to ThndrX (it currently requires a *Thndr Trader* subscription)

## Install

```bash
git clone https://github.com/armaaar/thndr-mcp && cd thndr-mcp
npm install && npm run build
```

### Claude Code

```bash
claude mcp add thndr -- node /absolute/path/to/thndr-mcp/dist/main.js
```

(Inside this repository the bundled [`.mcp.json`](.mcp.json) already registers it in dev mode.)

### Claude Desktop

```json
{
  "mcpServers": {
    "thndr": { "command": "node", "args": ["/absolute/path/to/thndr-mcp/dist/main.js"] }
  }
}
```

## Logging in

Thndr logins need two factors, just like ThndrX:

1. A 6-digit code sent to your Thndr email.
2. Approval of the login request **in the Thndr mobile app**.

You can do it from the terminal:

```bash
npm run login      # or: node dist/main.js login
```

…or just ask Claude to "log in to Thndr". It will use `login_start` → `login_verify_code` → (you approve on your
phone) → `login_complete`. The session is renewed automatically. When it finally expires, Claude calls
`login_request_approval` and you approve once more on your phone (no new email code).

Accounts that only use Google/Apple sign-in can use `login_import_session` with the `Cookie` header of a logged-in
`x.thndr.app` browser session.

The session is stored in `~/.config/thndr-mcp/session.json` (mode `0600`). Delete it or call `logout` to end it.

## Tools

| Area | Tools |
| --- | --- |
| Session | `auth_status`, `login_start`, `login_verify_code`, `login_request_approval`, `login_complete`, `login_import_session`, `logout` |
| Market data | `search_instruments`, `get_instrument_details`, `get_price_snapshot`, `get_price_history`, `get_market_depth`, `get_recent_trades`, `get_market_status`, `screen_market` |
| Portfolio | `get_account_summary`, `get_account_positions`, `get_position`, `get_account_orders`, `get_realized_returns`, `get_closed_trades`, `get_sell_journal`, `get_trading_metrics`, `get_account_activity` |
| Engagement | `get_watchlists`, `get_watchlist`, `create_watchlist`, `edit_watchlist`, `delete_watchlist`, `get_alerts`, `get_alert`, `create_alert`, `update_alert`, `delete_alert`, `get_notifications`, `mark_notifications_read` |

Tool names follow the [IBKR MCP](docs/adr/0008-ibkr-mcp-as-reference.md) where Thndr has an equivalent. Details are in
[`docs/use-cases`](docs/use-cases).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `THNDR_SESSION_FILE` | `~/.config/thndr-mcp/session.json` | Where credentials are stored |
| `THNDR_LANGUAGE` | `en` | `en` or `ar` for localized fields |
| `THNDR_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` (logs go to stderr) |
| `THNDR_RUNTIME_VERSION` | bundled | Override the `x-thndrx-runtime-version` header |
| `THNDR_API_BASE_URL` / `THNDR_WEB_BASE_URL` | `https://prod.thndr.app` / `https://x.thndr.app/api` | API endpoints |
| `THNDR_USER_AGENT` | Chrome-like | User agent shown in the phone approval prompt |

## Development

```bash
npm run dev            # run over stdio with tsx
npm run check          # typecheck + lint + tests with coverage gate (> 95%)
npm run sync:api       # re-download ThndrX and regenerate docs/api/endpoints.generated.md
npm run capture:fixtures  # (logged in) capture real response shapes to .cache/fixtures
```

Architecture: Domain-Driven Design with hexagonal layers ([ADR 0003](docs/adr/0003-ddd-hexagonal-architecture.md)).
See [`docs/`](docs/README.md) for ADRs, domain models, use cases and the API specs, and [`CLAUDE.md`](CLAUDE.md) for
contributor rules.

## License

MIT
