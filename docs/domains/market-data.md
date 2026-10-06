# Market Data (core subdomain)

Everything about the market itself — instruments, live quotes, history, order book, tape and the trading session —
plus screening of the whole-market snapshot.

**Context map ([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)):** Market Data is the upstream **supplier** of [Portfolio](portfolio.md) and
[Engagement](engagement.md) and depends on no other context. It offers an **Open Host Service** —
`src/application/market-data/services/*` (`InstrumentResolver`, `MarketQuotesCache`, `IndexMembership`) — with its domain types
(`src/domain/market-data/`) as the published language; customers never import its use cases. `AssetId` and `Market`
live in the shared kernel (`src/domain/shared-kernel/`), not in this context.

Code: `src/domain/market-data/` (repository interface in `repository.ts`), `src/application/market-data/`,
`src/repositories/thndr/market-data-repository.ts` (+ `src/data-sources/thndr/dto/market-data.ts`,
`repositories/thndr/translators/market-data.ts`); use-case classes in `src/application/market-data/queries/`,
shared `InstrumentResolver`, `MarketQuotesCache` and `IndexMembership` in `src/application/market-data/services/`;
screeners in `src/domain/market-data/screener.ts` (+ `repositories/thndr/translators/screener.ts`).
API: [docs/api/market-data.md](../api/market-data.md), market status in
[docs/api/trading-and-portfolio.md §2](../api/trading-and-portfolio.md). Use cases:
[use-cases/market-data.md](../use-cases/market-data.md).

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Market** | A Thndr market account/venue, wire value of the `market` query param. Supported: `egypt` (default; aliases `egx`, `eg`) and `us` (alias `usa`). |
| **Instrument** | A tradable or reference listing: stock, ETF, index or fund (`AssetClass`: `STOCK`, `ETF`, `INDEX`, `FUND`, `UNKNOWN`). |
| **Asset id** (`AssetId`) | Thndr's UUID for an instrument; the key used by every Thndr endpoint. Stored lower-case. |
| **Ticker** (`Ticker`, shared kernel) | Exchange symbol such as `COMI`. Case-insensitive input. Users and agents refer to instruments by ticker *or* asset id. |
| **Board** | EGX sub-market (`feed.market_id`, marketwatch `market_id`): `NOPL` main board, `OOTC` over-the-counter, `SME`, `INDX` indices, `FNDS` funds. On `Instrument.board` and `Quote.board`. |
| **Tags** | Thndr's visible labels on an instrument's details (`Instrument.tags`): its sector, its indices ("EGX30 Index"), "sharia", "Same Day Tradable", "dollar_hedge"… Informational only: Thndr cannot list the instruments under a tag. |
| **Index** | An `INDX` instrument (EGX30, EGX30 Capped, EGX70 EWI, EGX100 EWI, EGX35-LV, Shariah, Tamayuz). Its **level** is the last value of its marketwatch row, in points. Symbols with spaces are sanitised (`EGX70-EWI`). |
| **Constituent** (member) | An instrument listed in an index's `constituents`. Thndr gives membership only — **no weights**. |
| **Peer** | A comparable instrument: one of Thndr's "similar stocks" (recommendations) or another instrument of the same sector. |
| **Screener** | A named set of filters evaluated on the marketwatch snapshot exactly as ThndrX does. A **saved screener** is stored by the user in Thndr; a **preset** is one of ThndrX's five built-in "recommended screeners" (`momentum-movers`, `breakout-radar`, `value-yield`, `steady-performers`, `reversal-watch`). |
| **52-week high/low distance** | Screener-derived: \|last trade − 52-week high (low)\| / high (low) × 100, rounded to an integer (0 when either is 0). |
| **Suspended** | Trading halted on the symbol (Thndr `symbol_state === "S"`). |
| **Quote** | Point-in-time trading snapshot of one instrument: board, last, previous close, OHLC, change, bid/ask with sizes, volume, value, trades, daily price limits, 52-week range, P/E, EPS, dividend yield, listed shares, market cap, 5/30/90-day average volume, last trade price, volume and time. |
| **Last price** | `last_trade_price` when > 0, else `close_price` (0 means no trade yet today), as ThndrX does. `Quote.lastTradePrice` keeps the raw value (0 before the first trade) because ThndrX's screener formulas read it. |
| **Price limits** | Daily price band (`lowerLimit`/`upperLimit`): the exchange's circuit-breaker limits. |
| **Market cap** | Derived: `listedShares × last`. |
| **Relative volume** | `volume / averageVolume30d × 100` (percent of the 30-day average). |
| **Marketwatch** | Thndr's whole-market snapshot: one quote row per instrument of a market. |
| **Market indicators** | Index levels (EGX30, EGX70…) and reference rates, returned as sparse quotes (last, previous close, change %). |
| **Candle** / **resolution** | One OHLCV bar. Resolutions: `1min`, `5min`, `10min`, `1h`, `1d`, `1w` (wire `1MIN`…`1W`). |
| **History window** | The `from`/`to` range of a history request; Thndr serves about 5 years. |
| **Order book** (market depth) | Bids and asks aggregated by price level, each with quantity and order count, plus total bid/ask quantity. |
| **Spread** | Best ask − best bid, absolute and as percent of the mid price. |
| **Tape** (time & sales) | Executed trades (`TapeTrade`: price, quantity, side `BUY`/`SELL`/`UNKNOWN`, time, cursor). Paged backwards with a cursor. |
| **Market session** | Whether the market is open now, with today's open/close times. |
| **Screen** | Filtering and ranking the marketwatch snapshot by criteria (gainers, losers, most active, unusual volume, value…). |
| **Financial statement metric** | One line of a company's financials as Thndr reports it, by key (`revenues`, `net_income`, `total_assets`, `roe_%`, `revenue_growth_1y`…) with one value per period. Keys ending in `_%` and growth rates are percent. |
| **Reporting basis** (`FinancialMode`) | How periods are cut: **TTM** (`ttm`, trailing twelve months at each quarter end, "TTM Q2 26": flows are 12-month sums; our default, comparable across companies), **QoQ** (`qoq`, single quarters, "Q2 26"; ThndrX's default view), **YoY** (`yoy`, fiscal years, "2025"). |
| **Latest value** | The last element of a metric's series (as ThndrX reads it); the **latest period** is the most recent period any metric reports. |
| **Valuation multiples** | P/E, P/B, P/S, PEG, EV/EBITDA, EV/EBIT computed against the latest period (`valuation()`); EV = market cap + debt − cash − short-term investments. Thndr serves none of them: they are derived, as ThndrX does. |
| **Period end** | The last instant of a reporting period (`periodEnd()`, ThndrX module 13280): quarters end 31 Mar / 30 Jun / 30 Sep / 31 Dec (TTM periods with their quarter), fiscal years 31 Dec, at 23:59:59.999 UTC. |
| **Valuation price** | The price a company's own multiples use (`valuationPrice()`, ThndrX `valuateForPeriod`): the close of the last daily candle at or before the end of its latest period, from 3 years of candles (8 for `yoy`). Falls back to the current price without a period end or candles (as ThndrX) and when the candles do not reach back to the period end (ThndrX shows nothing then). Sector peers are always valued at the current price. |
| **Sector comparison** | ThndrX's ranking of a company against every company of the same marketwatch sector with listed shares: per metric the sector median/min/max (zeros dropped) and a **percentile rank** 1–100 (100 = best, reversed when lower is better); per category a **rating** = rounded mean percentile of rated metrics, banded green/lightGreen/yellow/orange/red on the unrounded mean. Always every metric ThndrX compares (`COMPARISON_METRICS`, each with the Thndr key or formula it comes from as `source`). The company's price-based metrics use its valuation price, the sector sample current prices, so their percentile can fall slightly outside 1–100 (as in ThndrX). |
| **Period return** | Close-to-close change over a trailing period (`1W` … `5Y`, `YTD`) from the **base close**: the last close on or before the period start (YTD: the last close of the previous year), else the first close at most 7 days after the start (`BASE_FORWARD_DAYS`: Thndr's ~5 years of candles often begin just after the 5Y start); `baseDate` says which. |
| **Historical volatility** | Annualised standard deviation of daily log returns over the last 30, 90 or 252 sessions: sample stdev × √252, in percent. |
| **Drawdown** | Fall of the close from its running peak; the **maximum drawdown** (1Y) is the largest one from the 1Y base close to the latest close. |
| **Thndr one-year return** | Thndr's own one-year figure on the asset details (`annual_return`: value + gain/loss), shown for reference; its method is not published. |
| **News article** | An item of Thndr's news feed: a news story or an exchange disclosure (`source` `egx`, often a PDF `link` with empty content), tagged with tickers. |
| **Macro indicator** | Egypt's macroeconomic data as ThndrX shows it: headline/core inflation (monthly and yearly), CBE overnight deposit/lending rates, treasury-bill average returns by tenor, quarterly unemployment, GDP. Overview readings carry Thndr's `growth` as `change` from the previous reading. |

## Model and invariants

| Element | Kind | Invariants / behaviour |
| --- | --- | --- |
| `AssetId` (shared kernel, `shared-kernel/asset-id.ts`) | value object | Must be a UUID (`8-4-4-4-12` hex); normalised to lower-case. `AssetId.isAssetId(raw)` tests without throwing. |
| `Market` (shared kernel, `shared-kernel/market.ts`) | enum + `parseMarket` | Empty → `egypt`; unknown → `VALIDATION_ERROR`. |
| `AssetClass` (shared kernel, `shared-kernel/market.ts`) | enum + `parseAssetClass` | Unknown wire values become `UNKNOWN` (never fails). |
| `Instrument` | read model | `id`, `ticker`, `name`, `assetClass`, `market`, `currency` (`EGP`/`USD`/null), `sector`, `board`, `tradable`, `suspended`, `priceDecimals` (2 or 3 on EGX), optional `description`, `logoUrl`, `tags` (visible tag names, Thndr's order, no duplicates). |
| `Quote` | read model | Every numeric field nullable (Thndr often omits them). `board` is `INDX` for index rows, which are in the snapshot but never screening results or peers. `relativeVolume(quote)` returns null without a 30-day average. |
| `Screener` (`screener.ts`) | read model, deep-frozen | `id`, `name`, `market`, `preset`, `filters` (each a `ScreenerField` and a condition: `between` inclusive with open null bounds, `oneOf`, `contains` ignoring case, `equals`, `equalsNumber`) and `unsupported` (Thndr filters that cannot be evaluated, described). `SCREENER_PRESETS` holds ThndrX's presets. |
| `matchesScreener(quote, filters)` | domain service | ThndrX's evaluator (bundle module 86697): derived `price`, `change`, `changePercent` (from `lastTradePrice` and previous close), `relativeVolume` (rounded; null fails the row), 52-week distances; `Number(null)` = 0 in ranges. `describeFilter` words a filter (`value ≥ 1,000,000`). |
| `Candle` | value (`createCandle`) | All of OHLCV finite, valid time, `high ≥ low`. Frozen. |
| `historyWindow(from, to, now)` | domain service | `from < to`; clamps to `[now − 5 years, now]`; empty after clamping → `VALIDATION_ERROR`. |
| `OrderBook` | read model | Bids best (highest) first, asks best (lowest) first. `spread(book)` is null when a side is empty or best bid ≤ 0. |
| `TapeTrade` | read model | Each trade carries the cursor used to page further back. |
| `MarketSession` | read model | `market`, `isOpen`, `opensAt`, `closesAt` (open/close nullable). |
| `FinancialStatements` (`financials.ts`, `createFinancialStatements`) | read model | `currency`, `mode`, `series` (metric key → `{period, value}` oldest first, values nullable). Frozen. `comparePeriods` orders "2025" / "Q2 26" / "TTM Q2 26" labels; `latestPeriod`, `latestValue`, `valueAt`, safe `ratio`. |
| `valuation(statements, market)` | domain service | Market cap needs listed shares and a price; P/E dropped when negative; P/B falls back to price / BVPS; nothing without a period. Values at `market.price` (the caller passes the valuation price for the company, the current price for peers). |
| `periodEnd(label)`, `valuationPrice(statements, candles, currentPrice)` | domain services | `periodEnd`: null for labels Thndr does not use. `valuationPrice`: the last candle with time ≤ the period end (any input order); `basis` `periodEndClose` with `priceDate`, or `currentPrice` with `reason` `noPeriod` / `noCandles` / `beforeHistory`. Frozen. `VALUATION_PRICE_YEARS` = 3 (`ttm`, `qoq`) / 8 (`yoy`). |
| `compareWithSector(company, sector, mode)` (`sector-comparison.ts`) | domain service | ThndrX's comparison metrics (`COMPARISON_METRICS`, frozen: category, lowerIsBetter, rated, hidden in `qoq`, `source`, `priceBased`), `sectorStats`, `percentileRank` (null with < 2 values), `ratingBand` (applied to the unrounded mean). |
| `pricePerformance(candles)` (`performance.ts`) | domain service | One session per Cairo market day (`marketDay`), positive closes only; `shiftDay` clamps month ends; base close on or before the start, else the first within `BASE_FORWARD_DAYS` (7) after it; returns null when history is too short; volatility null with fewer returns than the window; the 52-week range starts the day after the 1Y start and replaces lows ≤ 0 with the close; tied drawdown peaks keep the first. |
| `NewsArticle`, `NewsPage`, `EconomicIndicators`, `YearlyReturn` (`research.ts`) | read models | News ids are strings, tickers a list; macro series sorted oldest first. |

Thndr reference symbols that don't fit the `Ticker` pattern (e.g. `USD/EGP`, `EGX70 EWI`) are sanitised by the
anti-corruption layer (`USD-EGP`, `EGX70-EWI`) for indices and asset details.

## Application services

### `InstrumentResolver`
Turns what a user types into an `Instrument`:
- **Asset id** → cache hit or `GET /assets-service/assets/{id}`.
- **Ticker** → cache hit (keyed `market:TICKER`) or a search, keeping only the **exact** ticker match. No match →
  `NOT_FOUND` with up to five suggestions ("Did you mean: …?").
- Results are cached for the process lifetime (listings rarely change). Other use cases seed the cache with
  `remember()` (e.g. `SearchInstruments`). `resolveMany()` resolves in parallel.
- Used by Portfolio (positions, orders filter, trading-metrics ticker labels) and Engagement.

### `IndexMembership`
- Lists a market's indices — the `INDX` rows of the snapshot — and each index's members from its asset details
  (`constituents[].id`, fetched one index at a time to avoid bursts). Names come from the market indicators, matched by
  asset id (index rows have none); if that call fails the names stay null. Cached per market for **6 hours**
  (membership changes at rebalances); a failed load and an answer without index rows are not cached, and one with an
  index without members is kept for 5 minutes only.
- `find(symbol, market)`: exact match of the symbol, else of the name (a name shared by two indices is ambiguous) ignoring case and separators (`EGX70 EWI` =
  `egx70-ewi`, `EGX33 (Sharia)`, or the name's first word when it has a digit, `EGX33`), else the only index whose
  symbol starts with it (`EGX70` → `EGX70-EWI`); otherwise `NOT_FOUND` listing the indices.
- `membership(market)`: instrument id → symbols of its indices (used by `get_instrument_details`; open to Portfolio's
  allocation).

### `MarketQuotesCache`
- Caches the marketwatch snapshot per market for **10 s** (default `ttlMs`). One upstream call serves every
  snapshot, screen and mover request in that window.
- Caches the *promise*, so concurrent callers share one request; a failed request is evicted so the next call
  retries (a newer entry is never evicted).

## Screening semantics (`ScreenMarket`)

ThndrX evaluates screeners client-side on marketwatch rows; we do the same on the cached snapshot.

- Index rows (board `INDX`) are always excluded; with `index`, only the index's members are screened.
- Suspended instruments are excluded unless `includeSuspended`.
- `sector`: case-insensitive *substring* match on the quote's sector (EGX sector names such as "Banks",
  "Real Estate").
- Range filters: price (`minPrice`/`maxPrice` on last), change % (`min/maxChangePercent`), `minValue` (traded
  value), `minRelativeVolume` (%), `maxPeRatio`, `minDividendYield` (%). A row whose field is **null fails** any
  filter on that field.
- Sort by `changePercent` (default), `value`, `volume`, `relativeVolume`, `marketCap`, `last`,
  `dividendYieldPercent` or `peRatio`; `desc` by default. Nulls always sort last.
- Returns `total` matching rows and the first `limit` (default 20, max 100), each with `relativeVolume`.
- `preset` and `screenerId` add a ThndrX preset's or a saved screener's filters, evaluated with ThndrX's rules
  (`matchesScreener`, which differ from the explicit criteria: e.g. a null P/E counts as 0). Everything given applies
  together (AND). A saved screener with `unsupported` filters is refused (`VALIDATION_ERROR`) rather than run
  partially.
- Recipes: top gainers = default; top losers = `order: asc`; most active = `sortBy: value`; unusual volume =
  `minRelativeVolume: 200`.

## EGX trading session facts

From the ThndrX TradingView config and market-status endpoints:

| Board | Exchange label | Session (Africa/Cairo) |
| --- | --- | --- |
| Main (`NOPL`) | `EGX` | Sunday–Thursday, 10:00–14:30 |
| OTC (`OOTC`) | `EGX-OTC` | Monday and Wednesday, 12:00–12:30 |

- Live status comes from `GET /market-service/markets/status` (`is_active`), open/close times from
  `GET /market-service/markets/hours` (only meaningful while open; failures are tolerated → null times).
- Server error codes imply extra phases: pre-open adjustment, pre-close auction, pre-close adjustment, pre-close
  trading.
- EGX prices have 2 or 3 decimals; prices are in EGP for `egypt`.

## Repository

`MarketDataRepository` (domain repository, `src/domain/market-data/repository.ts`), implemented by
`ThndrMarketDataRepository` (`src/repositories/thndr/market-data-repository.ts`). Use cases receive
it as the `repository` dependency:

| Method | Thndr endpoint |
| --- | --- |
| `searchInstruments(query, market)` | `GET /assets-service/assets/search?query&market&include_feed&feed_detail` |
| `getInstrument(id)` | `GET /assets-service/assets/{id}` |
| `getMarketQuotes(market)` | `GET /assets-service/assets/marketwatch?market` |
| `getCandles(id, resolution, from, to)` | `GET /krakend-thndr-x/feed/advanced-charts/v2/{id}/trades` (unix-second timestamps) |
| `getOrderBook(id)` | `GET /assets-service/market-depth/{id}` |
| `getRecentTrades(id, limit, before?)` | `GET /assets-service/market-depth/v3/trades-book/{id}?page_size&before` |
| `getMarketSession(market, board?)` | `GET /market-service/markets/status` + `GET /market-service/markets/hours` |
| `getMarketIndicators(market)` | `GET /assets-service/assets/market-indicators?market&page_count=100` |
| `getIndexConstituents(indexId)` | `GET /assets-service/assets/{indexId}` → `constituents[].id` (empty for a non-index) |
| `getSimilarInstruments(id, market, limit)` | `GET /assets-service/assets/{id}/recommendations?market&recommendations_number&include_feed&feed_detail` |
| `getScreeners(market)` | `GET /users-service/screeners?market` |
| `getScreener(id)` | `GET /users-service/screeners/{id}` (404 → `NOT_FOUND`) |

All on `https://prod.thndr.app`; KrakenD responses pass through `assertNoKrakendError`.

`ResearchRepository` (`src/domain/market-data/research-repository.ts`), implemented by `ThndrResearchRepository`
(`src/repositories/thndr/research-repository.ts`, ADR 0018) and given to use cases as the `research` dependency:

| Method | Thndr endpoint |
| --- | --- |
| `getFinancials(ticker, mode, dataPointCount?)` | `GET x.thndr.app/api/financials?symbol&mode&dataPointCount` (404 or no series → `NOT_FOUND`) |
| `getFinancialsBatch(tickers, mode)` | `GET x.thndr.app/api/financials?symbols=A,B&mode` (404 → empty) |
| `getNews({assetId?, locale, page})` | `GET prod.thndr.app/api/post/news/?asset_id&locale&page` (404 past the last page → empty) |
| `getEconomicIndicators()` | `GET x.thndr.app/api/macros` |
| `getYearlyReturn(id)` | `GET prod.thndr.app/assets-service/assets/{id}?include_yearly_return=true` (`annual_return`) |
