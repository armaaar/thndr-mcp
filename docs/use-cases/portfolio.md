# Portfolio use cases

Code: one `Query` class per use case in `src/application/portfolio/queries/` (shared journal input and paging
helpers in `portfolio/journal-input.ts`, `portfolio/range-input.ts` (`from`/`to`/`period`) and
`src/application/paging.ts`; instrument resolution, the market snapshot and index membership through Market Data's
`InstrumentResolver`, `MarketQuotesCache` and `IndexMembership` services). MCP tools and CLI commands are generated from these classes; CLI
positionals come from `src/presentation/cli/positionals.ts`.
Domain: [domains/portfolio.md](../domains/portfolio.md). API:
[api/trading-and-portfolio.md](../api/trading-and-portfolio.md).

**Actor** for every use case: the LLM agent (MCP) or a user at a terminal (CLI `thndr`), acting on behalf of the
Thndr account holder. Both run the same use-case class through `runAndPresent`
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); add `--json` to a CLI command to get the exact MCP JSON.

**Common to all use cases**

- **Read-only** ([ADR 0006](../adr/0006-trading-safety.md)): nothing here places, modifies or cancels orders or
  moves funds (savings balances are read, never transferred). Every use case is a CQRS `Query`, so every MCP tool is annotated `readOnlyHint: true`.
- **Preconditions:** a Thndr session exists.
- **Input conventions:** `market` is `egypt` (default; EGX, EGP), `us` (NYSE/Nasdaq/ETFs via Alpaca, USD), `uae` (ADX, AED) or `simulator` (paper trading); activity, returns and the journal exist only in some markets (`FEATURE_DISABLED` otherwise) and savings are Egypt-only; `symbol` is a ticker or Thndr asset id.
  Date-filtered tools take either `from`/`to` (ISO dates; date-only values are Cairo market days) or a `period`
  preset — `today`, `7d`, `30d`, `90d` (the last N Cairo calendar days including today), `mtd`, `ytd`, `1y` (the
  last 12 months including today) — which starts at 00:00 Cairo on its first day and runs until now. Giving
  `period` together with `from` or `to` → `VALIDATION_ERROR`.
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
- **Goal:** Thndr's cumulative return to date and its evolution. Despite the endpoint's name, `total_returns` is the
  account value minus net deposits (unrealized gains included; live 2026-10-06), not realized P/L.
- **Input:** `market`, `interval` (`1M` default, `6M`, `1Y`, `2Y`).
- **Main flow:**
  1. Fetch current realized returns and the chart series in parallel.
  2. Sort the series oldest first and summarise it.
- **Alternative/error flows:** unknown interval → `INVALID_INPUT`; common errors.
- **Output:** `market`, `current` (`totalReturns`, `snapshotDate`), `interval`, `series` (`date`,
  `totalReturns`, `portfolioValue`, `netDeposits`), `seriesSummary` (`from`, `to`, `returnsChange`, `portfolioValueChange`,
  `portfolioValueChangePercent`).
- **Thndr endpoints:** `GET prod /market-service/realized-returns`,
  `GET prod /market-service/realized-returns/chart/{interval}`.

## Closed trades — `get_closed_trades` (`GetClosedTrades`)

- **Use case:** `GetClosedTrades` (`Query`) in `src/application/portfolio/queries/get-closed-trades.ts`
- **Invoke:** MCP `get_closed_trades {"from": "2026-01-01"}` · CLI `thndr get-closed-trades --from 2026-01-01 [--to 2026-03-31] [--symbol COMI]`
- **Goal:** round-trip trades from the trading journal.
- **Input:** `market`, `symbol` (ticker, optional), `from`, `to` (ISO dates, optional = all time) or `period`
  (preset, exclusive with `from`/`to`), `page` (default 1), `limit` (1–100, default 20).
- **Invoke (period):** MCP `get_closed_trades {"period": "ytd"}` · CLI `thndr get-closed-trades --period ytd`
- **Main flow:**
  1. Resolve `period` to a range, or validate `from`/`to` (`from < to`, `from` not in the future), and the ticker.
  2. Fetch one journal page.
  3. `hasMore` while rows seen so far < `total_count` (or a full page when no count).
- **Alternative/error flows:** invalid range or ticker, or `period` with `from`/`to` → `VALIDATION_ERROR`; common
  errors.
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
- **Input:** `from`, `to` (optional) or `period` (preset, exclusive with `from`/`to`), `market` (used only to
  resolve tickers; Thndr computes the metrics across all markets).
- **Main flow:**
  1. Resolve `period`, or validate the date range.
  2. Fetch the metrics.
  3. Resolve each per-instrument asset id to a ticker, best-effort (failure → `ticker: null`).
  4. Sort instruments by total return, best first.
- **Alternative/error flows:** invalid range, or `period` with `from`/`to` → `VALIDATION_ERROR`; ticker resolution
  failures are swallowed;
  common errors.
- **Output:** `overall` (totalReturn, profitFactor, expectancyPerTrade, winRatePercent, averageWin, averageLoss,
  numberOfTrades, averagePositionSize, averageDurationDays, riskRewardRatio, expectancyR), `perInstrument`
  (instrumentId, ticker, totalReturn, totalPnlPercent, winRatePercent, numberOfTrades, averageWin, averageLoss,
  averagePositionSize).
- **Thndr endpoints:** `GET krakend /trading-journals/v1/trading-metrics` (+ resolve).

## Account activity — `get_account_activity` (`ListAccountActivity`)

- **Use case:** `ListAccountActivity` (`Query`) in `src/application/portfolio/queries/list-account-activity.ts`
- **Invoke:** MCP `get_account_activity {"category": "DIVIDEND"}` · CLI `thndr get-account-activity --category DIVIDEND [--page-size 50]`
  · range: MCP `get_account_activity {"period": "90d", "category": "DEPOSIT"}` · CLI `thndr get-account-activity --period 90d --category DEPOSIT`
- **Goal:** the cash ledger — deposits, withdrawals, executions, dividends, fees, transfers, rewards.
- **Input:** `market`, `category` (optional: `TRADE`, `DEPOSIT`, `WITHDRAWAL`, `DIVIDEND`, `FEE`, `TRANSFER`,
  `REWARD`, `OTHER`), `from`/`to` or `period` (optional, mutually exclusive), `page` (default 1; page mode only),
  `pageSize` (1–100, default 20; page mode only).
- **Main flow (page mode, no range):**
  1. Fetch one page from the market's provider (`EGID` for egypt, `ALPACA` for us, `ADX_UAE` for uae; the simulator has no activity feed).
  2. Categorise each row; if `category` is given, filter the fetched page.
- **Main flow (range mode, `from`/`to`/`period`):**
  1. Resolve the range (same rules as the journal tools; errors say "Activity").
  2. Fetch pages of 100 from page 1 until a page reaches entries older than the start, the last page, or a hard cap
     of 20 pages (2,000 rows).
  3. Keep entries whose `createdAt` is inside the range (entries without a timestamp are left out) and match
     `category`; sort newest first.
- **Alternative/error flows:** unknown category or period → `INVALID_INPUT`; `period` with `from`/`to`, or
  `page` > 1 with a range → `VALIDATION_ERROR`; common errors. Page mode: filtering can leave a page short or
  empty while `hasMore` is still true — keep paging. Range mode: `truncated: true` (and `hasMore: true`) when the
  cap was hit before the start of the range — narrow the range.
- **Output:** `market`, `activities` (id, type, category, amount (signed), createdAt, description, ticker),
  `page`, `hasMore`; in range mode also `range` (`from`, `to`), `truncated`, `pagesFetched`.
- **Thndr endpoints:** `GET prod /funding-service/account-activities`.

## Portfolio allocation — `get_portfolio_allocation` (`GetPortfolioAllocation`)

- **Use case:** `GetPortfolioAllocation` (`Query`) in `src/application/portfolio/queries/get-portfolio-allocation.ts`
- **Invoke:** MCP `get_portfolio_allocation` · CLI `thndr get-portfolio-allocation [--market us]`
- **Goal:** how the holdings are spread by asset class, sector and index (IBKR `get_pa_allocation`).
- **Markets:** all. Egypt (and the simulator, which reads Egypt's data — `snapshotMarket`): sectors from the
  snapshot and index buckets. US and UAE: no marketwatch or index call (Thndr answers 400 there); sectors from
  instrument details; `byIndex: []`.
- **Input:** `market`.
- **Main flow:**
  1. In parallel: wallet and portfolio, and — when the market has a snapshot (Egypt; Egypt's for the simulator) —
     the snapshot (`MarketQuotesCache`, 10 s cache) and index membership (`IndexMembership`, 6 h cache).
  2. Weight each position by market value against the portfolio value (domain `computeAllocation`).
  3. Join each position to its marketwatch row by instrument id, else by ticker, for the sector; take its indices
     from the membership map.
  4. Holdings without a snapshot row (every US/UAE holding, US listings of the simulator, Egyptian rows missing from
     the snapshot) that carry an instrument id: their sector is Thndr's industry from the instrument details
     (`InstrumentResolver`, cached), heaviest first, at most 30 lookups (`MAX_SECTOR_LOOKUPS`), 5 at a time; lighter
     holdings beyond the cap and failed lookups stay `Unclassified`, and a note gives the counts.
  5. Group (domain `groupAllocation`): by asset class, by sector (no sector → `Funds (no sector)` for funds/ETFs,
     else `Unclassified`), and by index (no index → `Not in any index`) where the market has indices.
- **Alternative/error flows:** common errors (the account, snapshot or membership read failing fails the call; a
  detail lookup failing with a Thndr error or not-found only leaves that holding unclassified; a session error still
  fails the call). No holdings → empty lists.
- **Output:** `market`, `currency`, `portfolioValue`, `basis` (denominator of every weight), `totalMarketValue`,
  `holdings` (ticker, instrumentId, assetClass, sector, indices, marketValue, weightPercent), `byAssetClass`
  (assetClass, positions, marketValue, weightPercent), `bySector` and `byIndex` (name, positions, marketValue,
  weightPercent, tickers; `byIndex` is `[]` outside Egypt), `notes` (outside Egypt: no index buckets; when details
  were used: how many holdings were looked up, skipped or failed).
- **Notes:** weights exclude cash (portfolio value = positions). **Index buckets overlap** — a holding counts in
  every index it belongs to — so they do not sum to 100%. There is no country breakdown: every Thndr Egypt holding
  is EGX-listed. Mutual funds (e.g. a money-market fund) are not marketwatch rows, so they have no sector.
- **Thndr endpoints:** `GET prod /market-service/accounts/wallet-and-portfolio`; Egypt/simulator: `GET prod
  /assets-service/assets/marketwatch`, `GET prod /assets-service/assets/{indexId}` per index (`constituents`); holdings
  outside the snapshot: `GET prod /assets-service/assets/{id}` (≤ 30).

## Portfolio performance — `get_portfolio_performance` (`GetPortfolioPerformance`)

- **Use case:** `GetPortfolioPerformance` (`Query`) in `src/application/portfolio/queries/get-portfolio-performance.ts`
- **Invoke:** MCP `get_portfolio_performance` · CLI `thndr get-portfolio-performance`
- **Goal:** how the portfolio did over 1D, 7D, MTD, 1M, 6M, YTD, 1Y and 2Y, net of deposits (IBKR
  `get_pa_performance_all_periods`).
- **Input:** `market`.
- **Main flow:**
  1. Fetch the returns chart `6M` (daily) and `2Y` (weekly) in parallel — two calls cover every period (`1M` is
     contained in `6M`, `1Y` in `2Y`; other intervals answer 422).
  2. Merge them into one timeline: weekly points before the daily series starts, then daily points; points without
     a portfolio value are dropped (domain `mergeReturnsSeries`).
  3. Per period, find the base snapshot day (domain `periodBaseDay`): a snapshot dated D is the close of D, so a
     period is measured from the close before its first day. Rolling periods count back from the latest snapshot
     (Thndr's snapshots lag today by about a day): 1D = end − 1 day, 7D = end − 7 days, 1M/6M/1Y/2Y = end − 1/6/12/24
     months. MTD/YTD start on the 1st of today's month/year in Cairo (base = the last day before it).
  4. Base = last point on or before the base day; if the timeline starts later, its first point is used and the
     period is flagged `partial`. End = latest point (domain `periodPerformance`).
- **Figures:** `valueChange = endValue − startValue`; `netDepositsChange` = change of cumulative net deposits;
  `gainExcludingDeposits = valueChange − netDepositsChange`; `thndrTotalReturnsChange` = change of Thndr's
  `total_returns` (account value − net deposits, unrealized included, so it normally equals
  `gainExcludingDeposits`; not realized profit); `timeWeightedReturnPercent` chains
  `r_i = (V_i − min(F_i, 0)) / (V_(i−1) + max(F_i, 0)) − 1` over consecutive snapshots (`F_i` = change of net
  deposits) — **assumption:** deposits arrive at the start of a sub-period (invested for it) and withdrawals at its
  end, so a large flow cannot distort the return of the money already there; sub-periods with nothing at risk are
  skipped; null when a snapshot lacks net deposits. Values are the account value (positions + cash). A period whose
  window has a single snapshot (e.g. MTD on the 1st) has null figures. Snapshots are daily including weekends, so
  1D compares the latest snapshot with the day before.
- **Alternative/error flows:** common errors. No snapshots → every period `partial` with null figures.
- **Output:** `market`, `currency`, `asOf` (latest snapshot), `periods` (period, requestedFrom (base day),
  from/to (snapshot dates used), partial, granularity (`daily`, `weekly` or `weekly+daily`), startValue, endValue,
  valueChange, netDepositsChange, gainExcludingDeposits, timeWeightedReturnPercent, thndrTotalReturnsChange),
  `series` (interval, granularity, from, to, points per fetched series), `method` (the formulas above, in words).
- **Notes:** periods longer than the daily series (6M usually needs one weekly point, since the daily series starts
  the day after the 6M base; 1Y, 2Y) are approximations at weekly granularity and say so. `get_realized_returns`
  is unchanged and still returns the raw series.
- **Thndr endpoints:** `GET prod /market-service/realized-returns/chart/6M`, `GET prod
  /market-service/realized-returns/chart/2Y`.

## Savings — `get_savings` (`GetSavings`)

- **Use case:** `GetSavings` (`Query`) in `src/application/portfolio/queries/get-savings.ts`
- **Invoke:** MCP `get_savings` · CLI `thndr get-savings`
- **Goal:** the user's savings ("Clouds") balances and the current yield of each savings product. **Read-only:**
  no transfer into or out of savings is possible ([ADR 0006](../adr/0006-trading-safety.md),
  [ADR 0018](../adr/0018-analytics-from-thndr-data-only.md)).
- **Input:** none (savings are EGP only; no `market`).
- **Main flow:** fetch balances and product stats in parallel.
- **Alternative/error flows:** KrakenD embedded error (`error_get_clouds`, `error_clouds_stats`) → `UPSTREAM_ERROR`;
  common errors. No savings → zero totals and empty `clouds`.
- **Output:** `currency` (`EGP`), `totalAmount`, `totalGain`, `count`, `amountsPerType` (product type → amount),
  `clouds` (id, name, type, amount, gains, withdrawableAmount), `yields` (product, currentlyEarningPercent,
  lastUpdatedAt (as Thndr sends it, no time zone), nominalYieldsPercent: daily, weekly, monthly, quarterly,
  semiAnnually), `note`.
- **Thndr endpoints:** `GET krakend /savings/v1/clouds`, `GET krakend /savings/v1/clouds-stats`.
