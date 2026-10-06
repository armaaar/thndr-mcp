# Portfolio (core subdomain)

A **read-only** view of the account holder's Thndr account: cash, positions, what can be sold, order history and
status, realized returns, the trading journal and the account statement. Downstream of [Market Data](market-data.md)
(uses `InstrumentResolver`).

Code: `src/domain/portfolio/`, `src/application/portfolio/use-cases.ts`, `src/application/ports/portfolio.ts`.
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
| **Realized returns** | Cumulative realized profit/loss as of a snapshot date, plus a series over `1M`, `6M`, `1Y` or `2Y` with portfolio value. |
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
| `RealizedReturns`, `ReturnsPoint`, `summarizeReturnsSeries` | `returns.ts` | Interval ∈ `1M`/`6M`/`1Y`/`2Y` (default `1M`). Summary: window from/to, `returnsChange` (last − first), portfolio value change and change % (when start value > 0). |
| `ClosedTrade`, `SellJournalEntry`, `JournalPage<T>` | `journal.ts` | Page has `entries`, `totalCount` (nullable), `page`, `hasMore`. |
| `TradingMetrics` (`createOverallTradingStats`) | `journal.ts` | Ratios null when average loss is unknown or 0. |
| `journalRange(from, to, now)` | `journal.ts` | Both optional (all time); valid dates; `from < to`; `from` not in the future. |
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

## Port

`PortfolioRepository` (`src/application/ports/portfolio.ts`), implemented by `ThndrPortfolioRepository`:

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

Order filter → wire `status`: `all` → none, `open` → `PENDING`, `completed` → `COMPLETED`, `cancelled` →
`CANCELLED`, `closed` → `CLOSED`.

## Out of scope (ADR 0006)

thndr-mcp is **read-only with respect to money** ([ADR 0006](../adr/0006-trading-safety.md)):

- **No order entry**: nothing places, modifies or cancels orders, stop orders or brackets. The `Order` model has
  no such behaviour, and the order-entry endpoints (`/market-service/orders`, `…/{id}/cancel`, `…/{id}/edit`,
  stop-order and fee/max-cash calculators) are deliberately not implemented. IBKR's
  `create_order_instruction` / `delete_order_instruction` have no equivalent.
- **No fund movement**: no deposits, withdrawals or savings ("Clouds") transfers.
- Users act on insights in the official Thndr app. Adding any of this needs a superseding ADR with a
  human-in-the-loop design.
