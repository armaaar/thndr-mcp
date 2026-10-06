# Engagement use cases

Code: one class per use case in `src/application/engagement/queries/` and `commands/`; shared `InstrumentLabeler`
in `src/application/engagement/services/`. MCP tools and CLI commands are generated from these classes; CLI
positionals come from `src/presentation/cli/positionals.ts`. Domain: [domains/engagement.md](../domains/engagement.md).
API: [api/market-data.md](../api/market-data.md) §4, §5.2 and misc §5. Tool names mirror the IBKR MCP
([ADR 0008](../adr/0008-ibkr-mcp-as-reference.md)).

**Actor** for every use case: the LLM agent (MCP) or a user at a terminal (CLI `thndr`), acting on behalf of the
Thndr account holder. Both run the same use-case class through `runAndPresent`
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); add `--json` to a CLI command to get the exact MCP JSON.

**Common to all use cases**

- **Preconditions:** a Thndr session exists (full-access bearer token on every call).
- **Input conventions:** `market` is `egypt` (default) or `us`; symbols are tickers (`COMI`, any case) or Thndr
  asset ids, resolved by `InstrumentResolver`. Results always carry tickers next to asset ids (via
  `InstrumentLabeler`; unknown ids get `ticker: null` instead of failing).
- **Common error flows:**
  - No session → `NOT_AUTHENTICATED`; refresh credential rejected → `SESSION_EXPIRED`.
  - Argument outside the use case's zod contract (empty id, name over 50 characters, bad direction/frequency, too
    many symbols) → `INVALID_INPUT`.
  - Invalid ticker format, or a rule rejected by the domain → `VALIDATION_ERROR`.
  - Ticker with no exact match → `NOT_FOUND`.
  - Thndr HTTP error, network error, KrakenD embedded `error_*` key or unexpected payload → `UPSTREAM_ERROR`.
- Hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`.

---

## List watchlists — `get_watchlists` (`GetWatchlists`)

- **Use case:** `GetWatchlists` (`Query`) in `src/application/engagement/queries/get-watchlists.ts`
- **Invoke:** MCP `get_watchlists` · CLI `thndr get-watchlists`
- **Input:** `market`.
- **Flow:** 1. List the market's custom watchlists. 2. Label every asset id (one cached marketwatch call, resolver
  for the rest).
- **Errors:** common errors.
- **Output:** `{ market, watchlists: [{ id, name, color, icon, count, instruments: [{ instrumentId, ticker }] }] }`.
- **Thndr endpoints:** `GET prod /users-service/watchlists?market=`; labels: `GET prod
  /assets-service/assets/marketwatch` (+ `GET prod /assets-service/assets/{id}` for ids outside the snapshot).

## Get one watchlist — `get_watchlist` (`GetWatchlist`)

- **Use case:** `GetWatchlist` (`Query`) in `src/application/engagement/queries/get-watchlist.ts`
- **Invoke:** MCP `get_watchlist {"id": "…"}` · CLI `thndr get-watchlist <id>`
- **Input:** `id`, `market`.
- **Flow:** 1. Read the watchlist detail (only asset ids). 2. When it has no name, take name/colour/icon from the
  list of the market (a failing list is tolerated). 3. Label instruments with ticker, name, last price, change %.
- **Errors:** empty id → `INVALID_INPUT`; unknown id → `UPSTREAM_ERROR` (404); common errors.
- **Output:** `{ id, name, color, icon, count, market, instruments: [{ instrumentId, ticker, name, last,
  changePercent }] }`.
- **Thndr endpoints:** `GET prod /users-service/watchlists/{id}`, `GET prod /users-service/watchlists?market=`,
  marketwatch (labels).

## Create a watchlist — `create_watchlist` (`CreateWatchlist`)

- **Use case:** `CreateWatchlist` (`Command`) in `src/application/engagement/commands/create-watchlist.ts`
- **Invoke:** MCP `create_watchlist {"name": "Banks", "symbols": ["COMI", "CIEB"]}` · CLI `thndr create-watchlist Banks COMI CIEB` (first positional = `name`, the rest = `symbols`)
- **Input:** `name` (1–50 chars), `symbols` (optional, ≤ 100), `market`.
- **Flow:** 1. Validate the name. 2. Resolve and de-duplicate symbols (all before writing). 3. Create with
  `source: "thndrx"`. 4. Return the labelled watchlist.
- **Errors:** empty or over-long name / too many symbols → `INVALID_INPUT`; unknown ticker → `NOT_FOUND` (nothing created);
  response without id → `UPSTREAM_ERROR`.
- **Output:** as `get_watchlist`.
- **Thndr endpoints:** `POST prod /users-service/watchlists` `{ name, market, source: "thndrx", asset_ids }`.

## Edit a watchlist — `edit_watchlist` (`EditWatchlist`)

- **Use case:** `EditWatchlist` (`Command`) in `src/application/engagement/commands/edit-watchlist.ts`
- **Invoke:** MCP `edit_watchlist {"id": "…", "add": ["HRHO"], "remove": ["CIEB"]}` · CLI `thndr edit-watchlist <id> --add HRHO --remove CIEB [--name "New name"]`
- **Input:** `id`, optional `name`, `add` (symbols, ≤ 100), `remove` (symbols or asset ids, ≤ 100), `market`.
- **Flow:** 1. Validate; at least one change is required. 2. Resolve `add`; for `remove`, raw asset ids are used
  as-is (so delisted instruments can be removed), tickers are resolved. 3. Reject an instrument present in both.
  4. Apply in order: rename → watch → unwatch (each only if needed). 5. Re-read the watchlist.
- **Errors:** empty or over-long name → `INVALID_INPUT`; nothing to change / conflict → `VALIDATION_ERROR`; unknown ticker → `NOT_FOUND` (before
  any write). A failure mid-way leaves earlier steps applied (Thndr has no transaction); the error says which call
  failed.
- **Output:** as `get_watchlist` plus `changes: { renamed, added: assetId[], removed: assetId[] }`.
- **Thndr endpoints:** `PATCH prod /users-service/watchlists/{id}` `{ name }`, `POST prod
  /users-service/watchlists/{id}/watch-assets` `{ asset_ids }`, `POST …/unwatch-assets` `{ asset_ids }`, then the
  `get_watchlist` endpoints.

## Delete a watchlist — `delete_watchlist` (`DeleteWatchlist`)

- **Use case:** `DeleteWatchlist` (`Command`) in `src/application/engagement/commands/delete-watchlist.ts`
- **Invoke:** MCP `delete_watchlist {"id": "…"}` · CLI `thndr delete-watchlist <id>`
- **Input:** `id`.
- **Flow:** delete the watchlist.
- **Errors:** empty id → `INVALID_INPUT`; common errors.
- **Output:** `{ id, deleted: true }`.
- **Thndr endpoints:** `DELETE prod /users-service/watchlists/{id}`.

## List price alerts — `get_alerts` (`GetAlerts`)

- **Use case:** `GetAlerts` (`Query`) in `src/application/engagement/queries/get-alerts.ts`
- **Invoke:** MCP `get_alerts {"symbol": "COMI"}` · CLI `thndr get-alerts [--symbol COMI | --page 2 --page-count 50]`
- **Input:** `market`, and either `symbol` (alerts of one instrument) or paging `page` (≥ 1, default 1) and
  `pageCount` (1–100, default 20).
- **Flow:** *By symbol:* resolve, list that asset's alerts. *Otherwise:* list one page of the market's alerts.
  Then label tickers and attach the current price.
- **Errors:** common errors.
- **Output:** `{ market, page, pageCount, hasMore, alerts: [{ id, instrumentId, ticker, targetPrice, direction,
  frequency, createdAt, currentPrice }] }` (`hasMore` = the page was full, Thndr's own rule).
- **Thndr endpoints:** `GET krakend /price-alerts/v1/alerts?page=&page_count=&market=` or `GET krakend
  /price-alerts/v1/asset-alerts/{assetId}?page=1&page_count=5` (ThndrX's per-asset page; at most 5 alerts).

## Get one price alert — `get_alert` (`GetAlert`)

- **Use case:** `GetAlert` (`Query`) in `src/application/engagement/queries/get-alert.ts`
- **Invoke:** MCP `get_alert {"id": "…"}` · CLI `thndr get-alert <id>`
- **Input:** `id`, `market`.
- **Flow:** scan the market's alert pages (50 per page) until the id is found, a short page ends the list, or 10
  pages (500 alerts) were scanned.
- **Errors:** not found → `NOT_FOUND`; empty id → `INVALID_INPUT`.
- **Output:** one alert view (as in `get_alerts`).
- **Thndr endpoints:** `GET krakend /price-alerts/v1/alerts?page=N&page_count=50&market=`.

## Create a price alert — `create_alert` (`CreateAlert`)

- **Use case:** `CreateAlert` (`Command`) in `src/application/engagement/commands/create-alert.ts`
- **Invoke:** MCP `create_alert {"symbol": "COMI", "price": 90}` · CLI `thndr create-alert COMI 90 [--direction UP] [--frequency RECURRING]`
- **Input:** `symbol`, `price` (> 0), optional `direction` (`UP`/`DOWN`), `frequency`
  (`ONE_TIME` default, or `RECURRING`), `market`. The input contract accepts only these enum values; the
  domain parsers' aliases (`above`/`below`, `once`/`repeat`) apply only to direct use-case callers.
- **Flow:** 1. Validate price/direction/frequency. 2. Resolve the symbol. 3. Without a direction, derive it from the
  last price (`target < last → DOWN`, else `UP`). 4. Create. 5. If Thndr's reply does not describe the alert, look
  it up in the asset's alert list by price (and direction/frequency when known).
- **Errors:** bad input (non-positive price, unknown enum value) → `INVALID_INPUT`; no current price and no
  direction → `VALIDATION_ERROR`; KrakenD
  `error_price_alerts` → `UPSTREAM_ERROR`.
- **Output:** alert view; `id` is `null` only when the created alert could not be identified.
- **Thndr endpoints:** marketwatch (current price), `POST krakend /price-alerts/v1/alerts` `{ asset_id, price,
  frequency, direction, market }`, fallback `GET krakend /price-alerts/v1/asset-alerts/{assetId}`.

## Update a price alert — `update_alert` (`UpdateAlert`)

- **Use case:** `UpdateAlert` (`Command`) in `src/application/engagement/commands/update-alert.ts`
- **Invoke:** MCP `update_alert {"id": "…", "price": 95}` · CLI `thndr update-alert <id> --price 95`
- **Input:** `id`, at least one of `price`, `direction`, `frequency`; `market`.
- **Flow:** Thndr has **no update endpoint**; like ThndrX we delete and re-create. 1. Find the alert (as
  `get_alert`). 2. Merge: unchanged fields are carried over; if the price changed (or the stored direction is
  unknown) and no direction is given, derive it from the current price. 3. Delete the alert. 4. Create the new one.
  5. If creation fails, re-create the original alert (best effort) and fail.
- **Errors:** bad input → `INVALID_INPUT`; nothing to change / underivable direction → `VALIDATION_ERROR` (both
  before deleting);
  unknown id → `NOT_FOUND`; re-creation failure → `UPSTREAM_ERROR` stating whether the original was restored.
- **Output:** the new alert view (**new id**) plus `previousId`.
- **Thndr endpoints:** alert list pages, `DELETE krakend /price-alerts/v1/alerts/{id}`, `POST krakend
  /price-alerts/v1/alerts`.

## Delete a price alert — `delete_alert` (`DeleteAlert`)

- **Use case:** `DeleteAlert` (`Command`) in `src/application/engagement/commands/delete-alert.ts`
- **Invoke:** MCP `delete_alert {"id": "…"}` · CLI `thndr delete-alert <id>`
- **Input:** `id`.
- **Flow:** delete; a 404 (already fired or deleted) counts as success.
- **Errors:** empty id → `INVALID_INPUT`; other upstream errors → `UPSTREAM_ERROR`.
- **Output:** `{ id, deleted: true }`.
- **Thndr endpoints:** `DELETE krakend /price-alerts/v1/alerts/{id}`.

## List notifications — `get_notifications` (`GetNotifications`)

- **Use case:** `GetNotifications` (`Query`) in `src/application/engagement/queries/get-notifications.ts`
- **Invoke:** MCP `get_notifications {"unreadOnly": true}` · CLI `thndr get-notifications --unread-only [--page 2] [--page-count 50]`
- **Input:** `page` (≥ 1, default 1), `pageCount` (1–100, default 20), `unreadOnly` (filters the page client-side).
- **Flow:** fetch the page and the global unread flag in parallel.
- **Errors:** KrakenD `error_get_notifications` / `error_get_notifications_has_unread` → `UPSTREAM_ERROR`.
- **Output:** `{ page, pageCount, hasMore, hasUnread, notifications: [{ id, title, text, read, createdAt, type }] }`.
- **Thndr endpoints:** `GET krakend /notifications/v1?page=&page_count=`, `GET krakend /notifications/v1/has-unread`.

## Mark notifications read — `mark_notifications_read` (`MarkNotificationsRead`)

- **Use case:** `MarkNotificationsRead` (`Command`) in `src/application/engagement/commands/mark-notifications-read.ts`
- **Invoke:** MCP `mark_notifications_read {"ids": ["…"]}` · CLI `thndr mark-notifications-read <id> <id>…` or `thndr mark-notifications-read --all`
- **Input:** either `ids` (1–200, trimmed and de-duplicated) or `all: true` — not both.
- **Flow:** batch-mark the ids, or mark everything read.
- **Errors:** empty id or > 200 ids → `INVALID_INPUT`; neither or both given → `VALIDATION_ERROR`; KrakenD
  `error_patch_notifications_batch` / `error_patch_notifications_read_all` → `UPSTREAM_ERROR`.
- **Output:** `{ all, ids }`.
- **Thndr endpoints:** `PATCH krakend /notifications/v1/batch?field=is_read` body `[{ id }, …]`, or `PATCH krakend
  /notifications/v1/read-all` (no body).
