# Portfolio use cases

Code: one `Query` class per use case in `src/application/portfolio/queries/` (shared journal input and paging
helpers in `journal-input.ts`, `paging.ts`). MCP tools and CLI commands are generated from these classes; CLI
positionals come from `src/presentation/cli/positionals.ts`.
Domain: [domains/portfolio.md](../domains/portfolio.md). API:
[api/trading-and-portfolio.md](../api/trading-and-portfolio.md).

**Actor** for every use case: the LLM agent (MCP) or a user at a terminal (CLI `thndr`), acting on behalf of the
Thndr account holder. Both run the same use-case class through `runAndPresent`
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); add `--json` to a CLI command to get the exact MCP JSON.

**Common to all use cases**

- **Read-only** ([ADR 0006](../adr/0006-trading-safety.md)): nothing here places, modifies or cancels orders or
  moves funds. Every use case is a CQRS `Query`, so every MCP tool is annotated `readOnlyHint: true`.
- **Preconditions:** a Thndr session exists.
- **Input conventions:** `market` is `egypt` (default, EGP) or `us` (USD); `symbol` is a ticker or Thndr asset id.
  Arguments (MCP tool input or CLI flags) are checked first by the use case's zod `input` contract in `UseCase.run`
  (enums, ranges, ISO dates); the domain validates again (tickers, date ranges).
- **Common error flows:**
  - No session → `NOT_AUTHENTICATED`; refresh credential rejected → `SESSION_EXPIRED`.
  - Argument outside the contract (unknown status/interval/category, malformed date, out-of-range number) →
    `INVALID_INPUT`.
  - Invalid ticker, or a date range rejected by the domain (`from` after `to`, `from` in the future) →
    `VALIDATION_ERROR`.
  - Symbol with no exact match → `NOT_FOUND`.
  - Thndr HTTP error, network error, KrakenD embedded error or unexpected payload → `UPSTREAM_ERROR`.
- Hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`.

---

## Account summary — `get_account_summary` (`GetAccountSummary`)

- **Use case:** `GetAccountSummary` (`Query`) in `src/application/portfolio/queries/get-account-summary.ts`
- **Invoke:** MCP `get_account_summary` · CLI `thndr get-account-summary [--market us]`
- **Goal:** cash and value of the account.
- **Input:** `market`.
- **Main flow:**
  1. Fetch wallet and portfolio.
  2. Build the `AccountSummary` (derives available cash and total account value).
- **Alternative/error flows:** payload without `purchase_power` → `UPSTREAM_ERROR`; common errors.
- **Output:** `market`, `currency`, `buyingPower`, `blockedCash`, `unsettledCash`, `settledCash`,
  `availableCash`, `portfolioValue`, `totalReturn`, `totalReturnPercent`, `totalAccountValue`, `positions` (count).
- **Thndr endpoints:** `GET prod /market-service/accounts/wallet-and-portfolio`.

## Positions — `get_account_positions` (`GetPositions`)

- **Use case:** `GetPositions` (`Query`) in `src/application/portfolio/queries/get-positions.ts`
- **Invoke:** MCP `get_account_positions {"sortBy": "unrealizedPnl"}` · CLI `thndr get-account-positions --sort-by unrealizedPnl [--order asc]`
- **Goal:** all holdings with P/L, weights and allocation.
- **Input:** `market`, `sortBy` (`marketValue` default, `unrealizedPnl`, `unrealizedPnlPercent`, `costValue`,
  `ticker`), `order` (`desc` default).
- **Main flow:**
  1. Fetch wallet and portfolio.
  2. Compute allocation against the portfolio value.
  3. Add `weightPercent` to each position and sort (nulls last).
- **Alternative/error flows:** common errors. No holdings → empty `positions`.
- **Output:** `market`, `currency`, `portfolioValue`, `totalReturn`, `totalReturnPercent`, `positions` (ticker,
  instrumentId, assetClass, currency, quantity, unit, averageCost, costValue, marketPrice, marketValue,
  unrealizedPnl, unrealizedPnlPercent, weightPercent), `allocation` (`totalMarketValue`, `basis`, `positions`,
  `byAssetClass`, `largestWeightPercent`).
- **Thndr endpoints:** `GET prod /market-service/accounts/wallet-and-portfolio`.

## Position in one instrument — `get_position` (`GetPosition`)

- **Use case:** `GetPosition` (`Query`) in `src/application/portfolio/queries/get-position.ts`
- **Invoke:** MCP `get_position {"symbol": "COMI", "includeSellable": true}` · CLI `thndr get-position COMI --include-sellable`
- **Goal:** the holding in one instrument and, optionally, how much can be sold now.
- **Input:** `symbol`, `market`, `includeSellable` (default `false`).
- **Main flow:**
  1. Resolve the symbol.
  2. Fetch the position (404 means not held).
  3. If held and `includeSellable`, fetch blocked quantities per settlement bucket.
- **Alternative/error flows:** not held → `held: false`, `position: null`, `sellable: null` (not an error);
  common errors.
- **Output:** `ticker`, `held`, `position`, `sellable` (`all`, `t0`, `t1`, `settled`, `unsalable` — each
  `total`/`blocked`/`available` — and `custodian`).
- **Thndr endpoints:** resolve + `GET krakend /portfolio/v1/position/{id}`; optionally
  `GET prod /market-service/accounts/positions/blocked-quantities/{id}`.

## Orders — `get_account_orders` (`ListOrders`)

- **Use case:** `ListOrders` (`Query`) in `src/application/portfolio/queries/list-orders.ts`
- **Invoke:** MCP `get_account_orders {"status": "open"}` · CLI `thndr get-account-orders --status open [--symbol COMI] [--cursor <nextCursor>]`
- **Goal:** order history and status.
- **Input:** `market`, `status` (`all` default, `open`, `completed`, `cancelled`, `closed`), `symbol` (optional),
  `limit` (1–100, default 20), `cursor` (from a previous call), `oldestFirst` (default false).
- **Main flow:**
  1. Resolve `symbol` to an asset id, if given.
  2. Request pages of at most 20, each asking only for what is still missing, until `limit` orders are collected
     or there is no next page.
  3. Return the orders and the exact next cursor.
- **Alternative/error flows:** unknown status → `INVALID_INPUT`; common errors.
- **Output:** `market`, `status`, `orders` (id, ticker, instrumentId, side, type, quantity, filledQuantity,
  remainingQuantity, price, averageFillPrice, status, statusDetail, isOpen, timeInForce, expiresAt,
  executionType, settlement, orderClass, brackets, createdAt, updatedAt), `nextCursor`.
- **Thndr endpoints:** `GET prod /market-service/v3/orders` (`status` → `PENDING`/`COMPLETED`/`CANCELLED`/
  `CLOSED`, none for `all`).

## Realized returns — `get_realized_returns` (`GetRealizedReturns`)

- **Use case:** `GetRealizedReturns` (`Query`) in `src/application/portfolio/queries/get-realized-returns.ts`
- **Invoke:** MCP `get_realized_returns {"interval": "1Y"}` · CLI `thndr get-realized-returns --interval 1Y`
- **Goal:** realized P/L to date and its evolution.
- **Input:** `market`, `interval` (`1M` default, `6M`, `1Y`, `2Y`).
- **Main flow:**
  1. Fetch current realized returns and the chart series in parallel.
  2. Sort the series oldest first and summarise it.
- **Alternative/error flows:** unknown interval → `INVALID_INPUT`; common errors.
- **Output:** `market`, `current` (`totalReturns`, `snapshotDate`), `interval`, `series` (`date`,
  `totalReturns`, `portfolioValue`), `seriesSummary` (`from`, `to`, `returnsChange`, `portfolioValueChange`,
  `portfolioValueChangePercent`).
- **Thndr endpoints:** `GET prod /market-service/realized-returns`,
  `GET prod /market-service/realized-returns/chart/{interval}`.

## Closed trades — `get_closed_trades` (`GetClosedTrades`)

- **Use case:** `GetClosedTrades` (`Query`) in `src/application/portfolio/queries/get-closed-trades.ts`
- **Invoke:** MCP `get_closed_trades {"from": "2026-01-01"}` · CLI `thndr get-closed-trades --from 2026-01-01 [--to 2026-03-31] [--symbol COMI]`
- **Goal:** round-trip trades from the trading journal.
- **Input:** `market`, `symbol` (ticker, optional), `from`, `to` (ISO dates, optional = all time), `page`
  (default 1), `limit` (1–100, default 20).
- **Main flow:**
  1. Validate the date range (`from < to`, `from` not in the future) and ticker.
  2. Fetch one journal page.
  3. `hasMore` while rows seen so far < `total_count` (or a full page when no count).
- **Alternative/error flows:** invalid range or ticker → `VALIDATION_ERROR`; common errors.
- **Output:** `entries` (ticker, instrumentId, openedAt, closedAt, averageEntryPrice, averageExitPrice, quantity,
  netPnl, netPnlPercent, durationDays), `totalCount`, `page`, `hasMore`.
- **Thndr endpoints:** `GET prod /market-service/trading-journals/full-trades`.

## Sell journal — `get_sell_journal` (`GetSellJournal`)

- **Use case:** `GetSellJournal` (`Query`) in `src/application/portfolio/queries/get-sell-journal.ts`
- **Invoke:** MCP `get_sell_journal {"from": "2026-01-01"}` · CLI `thndr get-sell-journal --from 2026-01-01 [--page 2]`
- **Goal:** each (possibly partial) sell with its realized P/L.
- **Input:** same as `get_closed_trades`.
- **Main flow:**
  1. Validate range and ticker.
  2. Fetch one page; `hasMore` when a full page came back.
- **Alternative/error flows:** as `get_closed_trades`.
- **Output:** `entries` (ticker, instrumentId, exitedAt, exitPrice, exitValue, quantitySold,
  averageEntryPrice, netPnl, netPnlPercent), `totalCount`, `page`, `hasMore`.
- **Thndr endpoints:** `GET krakend /trading-journals/v1/grouped-sells`.

## Trading metrics — `get_trading_metrics` (`GetTradingMetrics`)

- **Use case:** `GetTradingMetrics` (`Query`) in `src/application/portfolio/queries/get-trading-metrics.ts`
- **Invoke:** MCP `get_trading_metrics {"from": "2026-01-01"}` · CLI `thndr get-trading-metrics [--from 2026-01-01] [--to 2026-06-30]`
- **Goal:** performance statistics of the user's trading.
- **Input:** `from`, `to` (optional), `market` (used only to resolve tickers; Thndr computes the metrics across
  all markets).
- **Main flow:**
  1. Validate the date range.
  2. Fetch the metrics.
  3. Resolve each per-instrument asset id to a ticker, best-effort (failure → `ticker: null`).
  4. Sort instruments by total return, best first.
- **Alternative/error flows:** invalid range → `VALIDATION_ERROR`; ticker resolution failures are swallowed;
  common errors.
- **Output:** `overall` (totalReturn, profitFactor, expectancyPerTrade, winRatePercent, averageWin, averageLoss,
  numberOfTrades, averagePositionSize, averageDurationDays, riskRewardRatio, expectancyR), `perInstrument`
  (instrumentId, ticker, totalReturn, totalPnlPercent, winRatePercent, numberOfTrades, averageWin, averageLoss,
  averagePositionSize).
- **Thndr endpoints:** `GET krakend /trading-journals/v1/trading-metrics` (+ resolve).

## Account activity — `get_account_activity` (`ListAccountActivity`)

- **Use case:** `ListAccountActivity` (`Query`) in `src/application/portfolio/queries/list-account-activity.ts`
- **Invoke:** MCP `get_account_activity {"category": "DIVIDEND"}` · CLI `thndr get-account-activity --category DIVIDEND [--page-size 50]`
- **Goal:** the cash ledger — deposits, withdrawals, executions, dividends, fees, transfers, rewards.
- **Input:** `market`, `category` (optional: `TRADE`, `DEPOSIT`, `WITHDRAWAL`, `DIVIDEND`, `FEE`, `TRANSFER`,
  `REWARD`, `OTHER`), `page` (default 1), `pageSize` (1–100, default 20).
- **Main flow:**
  1. Fetch one page from the market's provider (`EGID` for egypt, `ALPACA` for us).
  2. Categorise each row; if `category` is given, filter the fetched page.
- **Alternative/error flows:** unknown category → `INVALID_INPUT`; common errors. Filtering can leave a page
  short or empty while `hasMore` is still true — keep paging.
- **Output:** `market`, `activities` (id, type, category, amount (signed), createdAt, description, ticker),
  `page`, `hasMore`.
- **Thndr endpoints:** `GET prod /funding-service/account-activities`.
