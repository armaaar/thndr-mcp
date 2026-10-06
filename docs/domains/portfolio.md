# Portfolio (core subdomain)

A **read-only** view of the account holder's Thndr account: cash, positions, what can be sold, order history and
status, realized returns and performance, allocation, savings balances, the trading journal and the account
statement.

**Context map ([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)):** Portfolio is a **customer** of [Market Data](market-data.md): it may use only Market
Data's published interface (its domain types and `src/application/market-data/services/*`, here `InstrumentResolver`,
`MarketQuotesCache` for sectors and `IndexMembership` for index members).
It never depends on Engagement or Identity, and no context depends on Portfolio. `AssetId`, `Market` and `Money` come
from the shared kernel.

Code: `src/domain/portfolio/` (repository interface in `repository.ts`), `src/application/portfolio/`
(use-case classes in `queries/`), `src/repositories/thndr/portfolio-repository.ts`
(+ `src/data-sources/thndr/dto/portfolio.ts`, `src/repositories/thndr/translators/portfolio.ts`).
API: [docs/api/trading-and-portfolio.md](../api/trading-and-portfolio.md). Use cases:
[use-cases/portfolio.md](../use-cases/portfolio.md).

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Market account** | Cash and holdings of one market (`egypt` → EGP, `us` → USD). Every query is per market. |
| **Buying power** | Cash usable for new buys (wire `purchase_power`). |
| **Blocked cash** | Cash reserved by open buy orders (wire `cash_in_holding`). |
| **Unsettled cash** | Sale proceeds not settled yet (wire `unsettled_cash`). |
| **Settled cash** | Optional settled-cash figure (wire `settled_cash`). |
| **Available cash** | Withdrawable cash, derived as ThndrX does: `buyingPower − unsettledCash`. |
| **Portfolio value** | Market value of all positions (wire `portfolio.portfolio_value`; falls back to the sum of positions). |
| **Total account value** | `blockedCash + buyingPower + portfolioValue` (ThndrX also adds savings; we don't). |
| **Total return** | Unrealized return of the open positions, amount and percent. |
| **Position** | A holding: ticker, asset class, currency, quantity (and `unit`, e.g. `grams` for gold funds), average cost, cost value, market price, market value, unrealized P/L amount and percent. |
| **Weight / allocation** | A position's share of the portfolio value (percent, 2 decimals), and the same grouped by asset class. |
| **Settlement** | When traded shares/cash settle. EGX buckets: **T0** (same day), **T1** (next day) and **settled** (shown as **T+2**). Orders carry `settlement` (`T0`, `T1`, `SETTLED`). |
| **Sellable quantity** | How much of a holding can be sold, per settlement bucket (`all`, `t0`, `t1`, `settled`) plus `unsalable` shares (pledged, corporate action…). Each bucket = total, blocked (by open sell orders), available. |
| **Custodian** | Where settled shares are held: `AUB` if any settled shares sit with AUB, else `THN`; `OTHER` exists upstream; null when unknown. |
| **Order** | A broker order seen read-only: side (`BUY`/`SELL`), type (`LIMIT`/`MARKET`), quantity, filled and remaining quantity, price, average fill price, statuses, time in force, expiry, execution type, settlement, order class, bracket legs, timestamps. |
| **Order status (coarse)** | Wire `order_status`: e.g. `QUEUED_SUBMIT`, `QUEUED_CANCEL`, `PENDING`, `CLOSED`, `COMPLETED`. |
| **Order status (detailed)** | Wire `order_status_details`: e.g. `FULFILLED`, `PARTIALLY_FILLED`, `REJECTED`, `EXPIRED`, `CANCELLED`, `INSUFFICIENT_FUNDS`, `PENDING_MCDR`… |
| **Open (working) order** | Coarse *or* detailed status in: `PENDING`, `PARTIALLY_FILLED`, `PENDING_CANCELLATION`, `PENDING_MCDR`, `PENDING_QUEUED_CANCEL`, `PENDING_QUEUED_SUBMIT`, `PENDING_REPLACE`, `PENDING_SUBMIT`, `QUEUED_CANCEL`, `QUEUED_SUBMIT`, `PROCESSING`. |
| **Order status filter** | History filter: `all`, `open` (aliases `pending`, `working`), `completed` (`filled`, `executed`), `cancelled` (`canceled`), `closed` (`past`). |
| **Bracket leg** | Informational take-profit / stop-loss leg attached to an order (trigger price, limit price, type, status such as `Active`, `Triggered`, `Cancelled`). |
| **Realized returns** | Cumulative realized profit/loss as of a snapshot date, plus a series over `1M`, `6M`, `1Y` or `2Y` with portfolio value and net deposits. |
| **Net deposits** | Cumulative deposits minus withdrawals at a returns-chart snapshot (wire `net_deposits`). Its change over a window is the money moved in or out. |
| **Gain excluding deposits** | `valueChange − netDepositsChange` over a window: what the portfolio earned, not what was paid in. |
| **Time-weighted return (TWR)** | Return that ignores the size and timing of deposits: sub-period returns `r_i = (V_i − ΔD_i) / V_(i−1) − 1` between consecutive snapshots, chained. Assumes cash flows arrive at the end of each sub-period; sub-periods starting from a value ≤ 0 are skipped. |
| **Performance period** | `1D`, `7D`, `MTD`, `1M`, `6M`, `YTD`, `1Y`, `2Y`. Measured from the last snapshot on or before the close before the period's first day; **partial** when the series starts later. |
| **Series granularity** | Spacing of the returns-chart points used: `daily` (1M/6M charts), `weekly` (1Y/2Y charts) or `weekly+daily`. |
| **Allocation bucket** | A group of holdings with its market value and weight: by asset class, by sector (`Unclassified` or `Funds (no sector)` when Thndr gives none), or by index (`Not in any index`). Index buckets overlap. |
| **Savings cloud** | A savings bundle in Thndr's savings product ("Clouds"): type (`INSTANT_EGP`, `MONTHLY_EGP`…), amount, gains, withdrawable amount. Read only. |
| **Savings yield** | Per product: the yield currently earned and nominal annual yields by frequency (daily, weekly, monthly, quarterly, semi-annually), in percent. |
| **Period preset** | Named date range in Cairo market days ending now: `today`, `7d`/`30d`/`90d` (last N days incl. today), `mtd`, `ytd`, `1y` (last 12 months incl. today). Exclusive with `from`/`to`. |
| **Trading journal** | Thndr's record of the user's completed trading, with three views below. |
| **Closed trade** | A round trip (entry → full exit): open/close dates, average entry/exit price, quantity, net P/L amount and percent, duration in days. |
| **Sell journal** | Individual (possibly partial) sells: exit date, exit price, exit value, quantity sold, average entry price, net P/L amount and percent. |
| **Trading metrics** | Journal statistics across all markets: total return, profit factor, expectancy per trade, win rate, average win/loss, number of trades, average position size, average duration; plus derived **risk/reward** (`averageWin / abs(averageLoss)`) and **expectancy R** (`expectancyPerTrade / abs(averageLoss)`). Also per instrument. |
| **Account activity** | The account statement: cash movements, executions, fees, dividends, transfers, rewards. Each row has a Thndr type (`BUY_ORDER`, `DIVIDEND`, `BANK_FEES`…) and a coarse **category**. |
| **Activity category** | `TRADE`, `DEPOSIT`, `WITHDRAWAL`, `DIVIDEND`, `FEE`, `TRANSFER`, `REWARD`, `OTHER`. |

## Model and invariants

| Element | File | Invariants / derivations |
| --- | --- | --- |
| `AccountSummary` (`createAccountSummary`) | `account-summary.ts` | Buying power, blocked, unsettled cash and portfolio value must be finite; optional figures finite when present. Derives `availableCash` and `totalAccountValue`. `accountCurrency(market)`: `us` → USD, else EGP. |
| `Position` (`createPosition`) | `position.ts` | Quantity finite and ≥ 0; optional numbers finite. Fallbacks (ThndrX formulas): `averageCost = costValue / qty`, `costValue = averageCost × qty`, `marketValue = qty × marketPrice`, `unrealizedPnl = marketValue − costValue`, `unrealizedPnlPercent = pnl / costValue × 100`. |
| `computeAllocation(positions, portfolioValue?)` | `position.ts` | Pure. Basis = portfolio value when positive, else sum of market values; positions without price count as 0; heaviest first; per-asset-class groups. |
| `SellableQuantity` / `quantityBucket` | `sellable-quantity.ts` | `available = max(total − blocked, 0)`; missing numbers count as 0. |
| `Order` (`createOrder`) | `order.ts` | Non-empty id, side `BUY`/`SELL`, quantity finite and ≥ 0. Statuses upper-cased. `isOpen` from the open set. `filledQuantity` = quantity when `FULFILLED` and not given. `remainingQuantity = quantity − filled` while open, else 0. For partially filled limit orders the displayed `price` is the limit price and `averageFillPrice` the wire price (when they differ at 3 dp). |
| `OrdersPage` | `order.ts` | `nextCursor` null on the last page. |
| `RealizedReturns`, `ReturnsPoint`, `summarizeReturnsSeries` | `returns.ts` | Interval ∈ `1M`/`6M`/`1Y`/`2Y` (default `1M`). A point has `date`, `totalReturns`, `portfolioValue` and optional `netDeposits`. Summary: window from/to, `returnsChange` (last − first), portfolio value change and change % (when start value > 0). |
| `mergeReturnsSeries`, `periodBaseDay`, `periodPerformance`, `timeWeightedReturn` | `performance.ts` | Pure. Weekly points only before the daily series starts; points without a value dropped. Base = last point on or before the base day, else the first point and `partial`. TWR in percent (4 dp), null without net deposits, 0 for one point. Results frozen. |
| `groupAllocation`, `sectorBucket` | `allocation.ts` | Pure. A holding may fall in several buckets (overlap); heaviest first, then by name; weights against the given basis (0 when the basis ≤ 0). |
| `SavingsBalances`, `SavingsCloud`, `SavingsYield` | `savings.ts` | Read model only; figures nullable as Thndr sends them. |
| `marketDay`, `addDays`, `addMonths`, `presetStartDay`, `presetStart` | `period.ts` | Cairo calendar days (`YYYY-MM-DD`); months clamp to the target month's length; presets start at 00:00 Cairo. |
| `ClosedTrade`, `SellJournalEntry`, `JournalPage<T>` | `journal.ts` | Page has `entries`, `totalCount` (nullable), `page`, `hasMore`. |
| `TradingMetrics` (`createOverallTradingStats`) | `journal.ts` | Ratios null when average loss is unknown or 0. |
| `journalRange(from, to, now, label?)` | `journal.ts` | Both optional (all time); valid dates; `from < to`; `from` not in the future. `label` names the data in errors (`Journal`, `Activity`). |
| `AccountActivity` (`createAccountActivity`) | `activity.ts` | Type upper-cased; category from a fixed type map, unknown → `OTHER`. Amount is signed, as Thndr reports it. |

The account snapshot (`AccountSnapshot` = summary + positions) behaves as the aggregate for a market account: it is
always read whole from one upstream call.

## Application rules worth knowing

- Positions referenced by symbol go through `InstrumentResolver`; a position lookup that Thndr answers with 404
  means **not held** (`held: false`), not an error.
- Order history pages at most 20 per upstream request and never over-fetches, so `nextCursor` stays exact.
- Trading metrics are keyed by asset id upstream; tickers are resolved best-effort (unresolvable → `ticker: null`)
  and instruments are sorted by total return, best first.
- Activity category filtering is applied to the fetched page (Thndr has no reliable server filter), so a page may
  contain fewer rows than `pageSize`.
- With a date range, activity is paged (100 per page, at most 20 pages) until entries are older than the start;
  `truncated` says the cap was hit.
- `period` and `from`/`to` are mutually exclusive (`VALIDATION_ERROR`); `period` is resolved with the clock in
  Cairo time (`range-input.ts`).
- Allocation joins positions to the market snapshot by instrument id, else ticker; funds are not marketwatch rows
  and get no sector.
- Performance reads exactly two series (`6M` daily, `2Y` weekly); derived figures carry the dates and granularity
  used ([ADR 0018](../adr/0018-analytics-from-thndr-data-only.md)).

## Repository

`PortfolioRepository` (domain repository, `src/domain/portfolio/repository.ts`), implemented by
`ThndrPortfolioRepository` (`src/repositories/thndr/portfolio-repository.ts`). Use cases receive it
as the `repository` dependency:

| Method | Thndr endpoint (`https://prod.thndr.app`) |
| --- | --- |
| `getAccount(market)` | `GET /market-service/accounts/wallet-and-portfolio?market` |
| `getPosition(id, market)` | `GET /krakend-thndr-x/portfolio/v1/position/{id}?market` (404 → null) |
| `getSellableQuantity(id, market)` | `GET /market-service/accounts/positions/blocked-quantities/{id}?market` |
| `listOrders(query)` | `GET /market-service/v3/orders?market&status&cursor&limit&sort_order&skip_funds=true&asset_id` |
| `getRealizedReturns(market)` | `GET /market-service/realized-returns?market` |
| `getReturnsChart(interval, market)` | `GET /market-service/realized-returns/chart/{1M\|6M\|1Y\|2Y}?market` |
| `getClosedTrades(query)` | `GET /market-service/trading-journals/full-trades?market&page&limit&symbol_code&from_date&to_date` |
| `getSellJournal(query)` | `GET /krakend-thndr-x/trading-journals/v1/grouped-sells` (same params) |
| `getTradingMetrics(range)` | `GET /krakend-thndr-x/trading-journals/v1/trading-metrics?from_date&to_date` (no market) |
| `listActivities(market, page, pageSize)` | `GET /funding-service/account-activities?provider=EGID\|ALPACA&page&page_size` |
| `getSavings()` | `GET /krakend-thndr-x/savings/v1/clouds` |
| `getSavingsYields()` | `GET /krakend-thndr-x/savings/v1/clouds-stats` |

Order filter → wire `status`: `all` → none, `open` → `PENDING`, `completed` → `COMPLETED`, `cancelled` →
`CANCELLED`, `closed` → `CLOSED`.

## Out of scope (ADR 0006)

thndr-mcp is **read-only with respect to money** ([ADR 0006](../adr/0006-trading-safety.md)):

- **No order entry**: nothing places, modifies or cancels orders, stop orders or brackets. The `Order` model has
  no such behaviour, and the order-entry endpoints (`/market-service/orders`, `…/{id}/cancel`, `…/{id}/edit`,
  stop-order and fee/max-cash calculators) are deliberately not implemented. IBKR's
  `create_order_instruction` / `delete_order_instruction` have no equivalent.
- **No fund movement**: no deposits, withdrawals or savings ("Clouds") transfers. Reading savings balances and
  yields (`get_savings`) is in scope ([ADR 0018](../adr/0018-analytics-from-thndr-data-only.md)); the transfer
  endpoints (`/savings/v1/transfer*`, `transfer-types`, `transfer-requests`) are deliberately not implemented.
- Users act on insights in the official Thndr app. Adding any of this needs a superseding ADR with a
  human-in-the-loop design.
