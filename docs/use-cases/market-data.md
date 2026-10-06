# Market Data use cases

Code: one `Query` class per use case in `src/application/market-data/queries/`. Market Data's Open Host Service is
`src/application/market-data/services/*` (`InstrumentResolver`, `MarketQuotesCache`, `IndexMembership`) together
with its domain types (`src/domain/market-data/`): the Portfolio and Engagement use cases consume those, never these
use cases ([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)). Fundamentals, news and
macro data come from the `research` dependency (`ResearchRepository`, ADR 0018), a Market Data dependency used only by
the Market Data use cases below. MCP tools and CLI commands are generated from these classes; CLI positionals come
from `src/presentation/cli/positionals.ts`.
Domain: [domains/market-data.md](../domains/market-data.md). API: [api/market-data.md](../api/market-data.md).

**Actor** for every use case: the LLM agent (MCP) or a user at a terminal (CLI `thndr`), acting on behalf of the
Thndr account holder. Both run the same use-case class through `runAndPresent`
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); add `--json` to a CLI command to get the exact MCP JSON.

**Common to all use cases**

- **Preconditions:** a Thndr session exists (every market-data endpoint is called with the full-access token).
- **Input conventions:** `market` is `egypt` (default; EGX, EGP), `us` (NYSE/Nasdaq/ETFs via Alpaca, USD), `uae` (ADX, AED) or `simulator` (paper trading); a tool asked for something its market lacks answers `FEATURE_DISABLED` naming where it is available; `symbol` is a ticker (`COMI`, any case) or a Thndr
  asset id (UUID), resolved by `InstrumentResolver`.
- **Common error flows:**
  - No session → `NOT_AUTHENTICATED`; refresh credential rejected → `SESSION_EXPIRED` (re-approve).
  - Argument outside the use case's zod contract (unknown field, wrong type, enum, range) → `INVALID_INPUT`.
  - Invalid ticker/asset id format → `VALIDATION_ERROR`.
  - Ticker with no exact match → `NOT_FOUND` (with up to five suggestions).
  - Thndr HTTP error, network error, KrakenD embedded error or unexpected payload → `UPSTREAM_ERROR`.
- Hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`, `web` =
  `https://x.thndr.app/api` (ThndrX's own routes, same full-access token).

---

## Search instruments — `search_instruments` (`SearchInstruments`)

- **Use case:** `SearchInstruments` (`Query`) in `src/application/market-data/queries/search-instruments.ts`
- **Invoke:** MCP `search_instruments {"query": "commercial"}` · CLI `thndr search-instruments commercial [--market us] [--limit 10]`
- **Goal:** find instruments by ticker or company name (English or Arabic).
- **Input:** `query` (non-empty), `market`, `limit` (1–50, default 20).
- **Main flow:**
  1. Search Thndr.
  2. Remember every hit in the resolver cache (later ticker lookups are free).
  3. Return the first `limit` results.
- **Alternative/error flows:** empty query → `INVALID_INPUT`; common errors.
- **Output:** `{ results: Instrument[] }` — id, ticker, name, assetClass, market, currency, sector, board,
  tradable, suspended, priceDecimals.
- **Thndr endpoints:** `GET prod /assets-service/assets/search`.

## Instrument details — `get_instrument_details` (`GetInstrumentDetails`)

- **Use case:** `GetInstrumentDetails` (`Query`) in `src/application/market-data/queries/get-instrument-details.ts`
- **Invoke:** MCP `get_instrument_details {"symbol": "COMI"}` · CLI `thndr get-instrument-details COMI`
- **Goal:** company profile and listing details of one instrument.
- **Input:** `symbol`, `market`.
- **Main flow:**
  1. Resolve the symbol to an asset id.
  2. In parallel: fetch the asset details (always fresh) and the market's index membership (`IndexMembership`,
     cached 6 h).
- **Alternative/error flows:** membership failure → `indices: null` (the details are still returned); common errors.
- **Output:** `Instrument` including `description`, `logoUrl` and `tags` (Thndr's visible labels, e.g. "Banks",
  "EGX30 Index", "Same Day Tradable") when Thndr sends them, plus `indices` (symbols of the indices the instrument
  belongs to, e.g. `["EGX30", "EGX30CAPPED"]`; `[]` for none). Themes among the tags (e.g. "Sharia") can be listed
  with `get_tags` / `get_tag_instruments`.
- **Thndr endpoints:** resolve (`/assets-service/assets/search` or cache) + `GET prod /assets-service/assets/{id}`;
  membership: `GET prod /assets-service/assets/marketwatch` + `GET prod /assets-service/assets/{indexId}` per index.

## Price snapshot — `get_price_snapshot` (`GetPriceSnapshot`)

- **Use case:** `GetPriceSnapshot` (`Query`) in `src/application/market-data/queries/get-price-snapshot.ts`
- **Invoke:** MCP `get_price_snapshot {"symbols": ["COMI", "HRHO"]}` · CLI `thndr get-price-snapshot COMI HRHO` (or `--symbols COMI,HRHO`)
- **Goal:** current quotes for up to 50 instruments.
- **Input:** `symbols` (1–50), `market`.
- **Main flow:**
  1. Resolve all symbols and load the market snapshot in parallel (snapshot cached 10 s).
  2. Pick each instrument's row from the snapshot.
- **Alternative/error flows:**
  - 0 or > 50 symbols → `INVALID_INPUT`.
  - Any unresolvable symbol → `NOT_FOUND` for the whole call.
  - Resolved but absent from the snapshot (e.g. an index) → listed in `missing`.
- **Output:** `quotes` (last, previousClose, open/high/low, change, changePercent, bid/ask and sizes, volume,
  value, trades, lower/upper price limit, 52-week high/low, P/E, EPS, dividend yield, listed shares, market cap,
  5/30/90-day average volume, last trade price and volume, board, suspended, lastTradeAt) and `missing` (tickers).
- **Thndr endpoints:** resolve + `GET prod /assets-service/assets/marketwatch`.

## Price history — `get_price_history` (`GetPriceHistory`)

- **Use case:** `GetPriceHistory` (`Query`) in `src/application/market-data/queries/get-price-history.ts`
- **Invoke:** MCP `get_price_history {"symbol": "COMI", "resolution": "1d", "bars": 60}` · CLI `thndr get-price-history COMI --resolution 1d --bars 60` (or `--from 2026-01-01 --to 2026-01-31`)
- **Goal:** OHLCV candles for charting or indicators.
- **Input:** `symbol`, `market`, `resolution` (`1min`, `5min`, `10min`, `1h`, `1d` default, `1w`), and either
  `bars` (1–2000, default 100) or `from`/`to` (ISO-8601).
- **Main flow:**
  1. `to` defaults to now. Without `from`, derive it from `bars` × resolution, over-fetching (×4 intraday and
     `1h`, ×1.6 daily/weekly) because markets are closed most of the time.
  2. Validate and clamp the window to the last 5 years up to now.
  3. Resolve the symbol, fetch candles, sort oldest first.
  4. Without `from`, keep only the last `bars` candles.
- **Alternative/error flows:** malformed dates → `INVALID_INPUT`; `from ≥ to` or a window entirely outside the last 5 years →
  `VALIDATION_ERROR`; malformed candles are dropped silently; common errors.
- **Output:** `ticker`, `resolution`, `from`, `to` (effective window), `candles` (`time`, `open`, `high`, `low`,
  `close`, `volume`).
- **Thndr endpoints:** resolve + `GET krakend /feed/advanced-charts/v2/{id}/trades`.

## Market depth — `get_market_depth` (`GetMarketDepth`)

- **Use case:** `GetMarketDepth` (`Query`) in `src/application/market-data/queries/get-market-depth.ts`
- **Invoke:** MCP `get_market_depth {"symbol": "COMI"}` · CLI `thndr get-market-depth COMI [--levels 20]`
- **Goal:** see the order book and spread.
- **Input:** `symbol`, `market`, `levels` (1–50, default 10).
- **Main flow:**
  1. Resolve the symbol and fetch the book.
  2. Compute the spread on the full book; trim each side to `levels`.
- **Alternative/error flows:** common errors. An empty side gives `spread: null`.
- **Output:** `ticker`, `bids` (best first), `asks` (best first) — each level `price`, `quantity`, `orders` —
  `totalBidQuantity`, `totalAskQuantity`, `spread` (`absolute`, `percent`).
- **Thndr endpoints:** resolve + `GET prod /assets-service/market-depth/{id}`.

## Recent trades — `get_recent_trades` (`GetRecentTrades`)

- **Use case:** `GetRecentTrades` (`Query`) in `src/application/market-data/queries/get-recent-trades.ts`
- **Invoke:** MCP `get_recent_trades {"symbol": "COMI"}` · CLI `thndr get-recent-trades COMI [--limit 100] [--before <cursor>]`
- **Goal:** time & sales (the tape).
- **Input:** `symbol`, `market`, `limit` (1–200, default 50), `before` (cursor from a previous call).
- **Main flow:**
  1. Resolve the symbol.
  2. Fetch up to `limit` trades older than `before`.
  3. Return the last trade's cursor as `nextCursor`.
- **Alternative/error flows:** common errors. No trades → `nextCursor: null`.
- **Output:** `ticker`, `trades` (`price`, `quantity`, `side` `BUY`/`SELL`/`UNKNOWN`, `time`, `cursor`),
  `nextCursor`.
- **Thndr endpoints:** resolve + `GET prod /assets-service/market-depth/v3/trades-book/{id}`.

## Market status — `get_market_status` (`GetMarketStatus`)

- **Use case:** `GetMarketStatus` (`Query`) in `src/application/market-data/queries/get-market-status.ts`
- **Invoke:** MCP `get_market_status` · CLI `thndr get-market-status [--market us]`
- **Goal:** is the market open now, today's session times and the market's main indices and benchmarks.
- **Input:** `market` (`egypt`, `us`, `uae`; the simulator has no status → `FEATURE_DISABLED`).
- **Main flow:**
  1. In parallel: market status + hours, the market-indicators levels feed, and the market's default indices
     (the mobile app's list: Egypt → EGX indices, US → SPY, QQQ, DIA…, UAE → FADGI…).
  2. The levels feed ignores the market (it mixes EGX indices, US ETFs, ADX indices and USD/EGP, live 2026-10-06), so
     the default list picks and orders the entries, matched by asset id (at most 20).
  3. Each pick's instrument details (cached by `InstrumentResolver`) must belong to the requested market — a guard in
     case the gateway's list mixes markets too (only the combined three-market call has been sampled live). A pick
     whose details fail is kept only when the feed has it; a pick missing from the feed is named from its details,
     with a null level.
- **Alternative/error flows:** hours failure → `opensAt`/`closesAt` null; default-list failure (or an empty list) →
  Egypt keeps the whole feed (previous behaviour), other markets `indices: []`; feed failure → only the defaults that
  could be named, without levels; status failure → `UPSTREAM_ERROR`; auth errors as usual.
- **Output:** `market`, `isOpen`, `opensAt`, `closesAt`, `indices` (`ticker`, `name`, `level`, `changePercent`,
  `previousClose`). EGX regular session: Sunday–Thursday 10:00–14:30 Africa/Cairo.
- **Thndr endpoints:** `GET prod /market-service/markets/status`, `GET prod /market-service/markets/hours`,
  `GET prod /assets-service/assets/market-indicators`, `GET app /explore/v1/default-market-indicators?market=`
  (+ `GET prod /assets-service/assets/{id}` per pick, cached for the process lifetime).

## Screen the market — `screen_market` (`ScreenMarket`)

- **Use case:** `ScreenMarket` (`Query`) in `src/application/market-data/queries/screen-market.ts`
- **Invoke:** MCP `screen_market {"sortBy": "value", "limit": 10}` · CLI `thndr screen-market --sort-by value --limit 10` (e.g. `--sector Banks --min-change-percent 2`, `--index EGX30`, `--preset momentum-movers`, `--screener-id <id>`)
- **Goal:** filter and rank every instrument — top gainers/losers, most active, unusual volume, value stocks,
  a sector, an index's members, a ThndrX preset or one of the user's saved screeners.
- **Input:** `market`, `index` (index symbol, e.g. `EGX30`, `EGX70 EWI`), `preset` (`momentum-movers`,
  `breakout-radar`, `value-yield`, `steady-performers`, `reversal-watch`), `screenerId` (a saved screener, see
  `get_screeners`), `sector` (substring), `minPrice`, `maxPrice`, `minChangePercent`, `maxChangePercent`,
  `minValue`, `minRelativeVolume` (%), `maxPeRatio`, `minDividendYield` (%), `includeSuspended` (default false),
  `sortBy` (`changePercent` default, `value`, `volume`, `relativeVolume`, `marketCap`, `last`,
  `dividendYieldPercent`, `peRatio`), `order` (`desc` default), `limit` (1–100, default 20).
- **Main flow:**
  1. In parallel: load the market snapshot (cached 10 s), resolve `index` with `IndexMembership` (cached 6 h) and
     load the saved screener (`screenerId`).
  2. Drop index rows (board `INDX`) and, with `index`, every non-member.
  3. Add relative volume to each row; apply the explicit criteria (null fields fail their filter) **and** the
     preset's and saved screener's filters, evaluated exactly as ThndrX does
     ([api §5.1](../api/market-data.md)).
  4. Sort (nulls last) and take `limit`.
- **Alternative/error flows:** unknown `index` → `NOT_FOUND` (lists the indices); unknown `screenerId` →
  `NOT_FOUND`; a saved screener with a filter thndr-mcp cannot evaluate, or saved for another market →
  `VALIDATION_ERROR` naming it; unknown
  `preset` → `INVALID_INPUT`; common errors. No matches → `total: 0`, empty `results`.
- **Output:** `market`, `index` (when given), `screeners` (applied preset/saved screener: `id`, `name`, `filters`
  in plain words), `total` (matches before the limit), `results` (quotes + `relativeVolume`).
- **Thndr endpoints:** `GET prod /assets-service/assets/marketwatch`; with `index`: `GET prod
  /assets-service/assets/{indexId}` per index (cached); with `screenerId`: `GET prod /users-service/screeners/{id}`.

## Screeners — `get_screeners` (`GetScreeners`)

- **Use case:** `GetScreeners` (`Query`) in `src/application/market-data/queries/get-screeners.ts`
- **Invoke:** MCP `get_screeners` · CLI `thndr get-screeners [--market us]`
- **Goal:** see which screeners can be run with `screen_market`.
- **Input:** `market`.
- **Main flow:**
  1. Load the user's saved screeners of the market.
  2. Describe each filter in plain words; add ThndrX's five built-in presets.
- **Alternative/error flows:** common errors. No saved screeners → `saved: []`.
- **Output:** `market`, `saved` and `presets`, each screener `id`, `name`, `filters` (e.g. `value ≥ 1,000,000`,
  `week52HighDistance ≤ 10`, `sector is one of …`) and `unsupported` (filters thndr-mcp cannot evaluate; such a
  screener is refused by `screen_market`).
- **Thndr endpoints:** `GET prod /users-service/screeners?market=`.

## Index constituents — `get_index_constituents` (`GetIndexConstituents`)

- **Use case:** `GetIndexConstituents` (`Query`) in `src/application/market-data/queries/get-index-constituents.ts`
- **Invoke:** MCP `get_index_constituents {"index": "EGX30"}` · CLI `thndr get-index-constituents EGX30 [--sort-by changePercent] [--limit 10]` (no argument lists the indices)
- **Goal:** list the market's indices, or the members of one index with their quotes.
- **Input:** `index` (optional; exact symbol or name ignoring case and separators — `EGX33` finds SHARIAH,
  "EGX33 (Sharia)" — or a unique symbol prefix: `egx70` → `EGX70-EWI`), `market`, `sortBy` (`marketCap` default, `changePercent`, `value`, `volume`, `last`, `ticker`),
  `order` (default `asc` for `ticker`, else `desc`), `limit` (1–300, default 100).
- **Main flow:**
  1. In parallel: load the market snapshot and the indices with their members (`IndexMembership`).
  2. Without `index`: return every index with its level (its marketwatch row's last value), change % and member
     count.
  3. With `index`: resolve it, join its members with their quotes, count the members absent from the snapshot,
     sort (nulls last) and take `limit`.
- **Alternative/error flows:** unknown or ambiguous `index` → `NOT_FOUND` (lists the indices); common errors.
- **Output:** without `index`: `market`, `indices` (`ticker`, `name`, `level`, `changePercent`, `memberCount`).
  With `index`: `market`, `index` (same fields), `total`, `members` (`ticker`, `name`, `sector`, `last`,
  `changePercent`, `value`, `volume`, `marketCap`) and `missingFromSnapshot`. Thndr publishes **no weights**, so none
  are returned.
- **Thndr endpoints:** `GET prod /assets-service/assets/marketwatch` + `GET prod /assets-service/assets/{indexId}`
  per `INDX` row, one at a time (`constituents`) + `GET prod /assets-service/assets/market-indicators` (index names);
  membership is cached 6 h (an answer without index rows is not cached; one with an index without members is kept 5
  minutes).

## Peers — `get_peers` (`GetPeers`)

- **Use case:** `GetPeers` (`Query`) in `src/application/market-data/queries/get-peers.ts`
- **Invoke:** MCP `get_peers {"symbol": "COMI"}` · CLI `thndr get-peers COMI [--limit 10]`
- **Goal:** comparable instruments for one stock.
- **Input:** `symbol`, `market`, `limit` (1–20, default 5; per list).
- **Main flow:**
  1. Resolve the symbol.
  2. In parallel: load the market snapshot and Thndr's "similar stocks" (`recommendations_number = limit`).
  3. Join the similar stocks with their quotes (the instrument itself is dropped).
  4. Same sector: the other non-index rows of the snapshot with the instrument's sector (its quote's sector, else
     its listing's), largest market cap first.
- **Alternative/error flows:** a similar stock absent from the snapshot keeps its ticker, name and sector with null
  prices; no sector → `sameSector: []`; common errors.
- **Output:** `market`, `ticker`, `sector`, `similar` and `sameSector` (each `ticker`, `name`, `sector`, `last`,
  `changePercent`, `value`, `marketCap`, `peRatio`, `dividendYieldPercent`), `sameSectorTotal`.
- **Thndr endpoints:** resolve + `GET prod /assets-service/assets/{id}/recommendations?market&recommendations_number&include_feed&feed_detail`
  + `GET prod /assets-service/assets/marketwatch`.

## Price performance — `get_price_performance` (`GetPricePerformance`)

- **Use case:** `GetPricePerformance` (`Query`) in `src/application/market-data/queries/get-price-performance.ts`
  (calculations: `pricePerformance` in `src/domain/market-data/performance.ts`)
- **Invoke:** MCP `get_price_performance {"symbol": "COMI"}` · CLI `thndr get-price-performance COMI`
- **Goal:** trailing performance and risk statistics of one instrument (IBKR has none; ADR 0018).
- **Input:** `symbol`, `market`.
- **Main flow:**
  1. Resolve the symbol.
  2. In parallel: daily candles from 5 years + 10 days ago up to now, and Thndr's own one-year return (asset details
     with `include_yearly_return=true`).
  3. Keep one session per Cairo market day (positive closes only), oldest first.
  4. Returns for `1W`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `3Y`, `5Y`: close to close, from the last close on or before the
     period start (calendar months, clamped at month ends; YTD from the last close of the previous year) to the
     latest close. When no close is on or before the start, the base is the first close at most 7 days after it:
     Thndr serves about 5 years of candles, so the 5Y start (often a weekend or holiday) usually precedes the first
     one. `baseDate` gives the day actually used. Null when history does not reach back that far.
  5. Annualised historical volatility for the last 30, 90 and 252 sessions: sample standard deviation of daily log
     returns × √252, in percent (null with too few sessions).
  6. 52-week high/low from the daily highs/lows after the 1Y start day (a low ≤ 0 is a bad bar: the session's close
     counts instead); maximum drawdown on closes from the 1Y base close (tied peaks keep the first).
- **Alternative/error flows:** common errors. No candles → nulls and empty lists. Thndr's one-year return fails
  (upstream or not-found error) → `thndrOneYearReturn: null` and a note; the statistics are still returned.
- **Output:** `ticker`, `name`, `currency`, `asOf` (day of the latest close), `lastClose`, `returns`
  (`[{period, startDate, baseDate, baseClose, returnPercent}]`), `volatility` (`[{window, tradingDays,
  annualisedPercent}]`), `week52` (`{high, highDate, low, lowDate}`), `maxDrawdown1Y` (`{percent, peakDate,
  troughDate}`), `thndrOneYearReturn` (`{percent, direction}` or null), `history` (`firstDate`, `sessions`), `method`,
  `notes?`.
  Percentages are rounded to 2 decimals and prices to 4. Thndr's daily candles look adjusted for corporate actions
  (fractional prices), so these figures can differ from raw closes. `thndrOneYearReturn` is Thndr's own figure; its
  method is not published.
- **Thndr endpoints:** (resolve) + `GET krakend /feed/advanced-charts/v2/{id}/trades?resolution=1D` +
  `GET prod /assets-service/assets/{id}?include_yearly_return=true`.

## Company financials — `get_financials` (`GetFinancials`)

- **Use case:** `GetFinancials` (`Query`) in `src/application/market-data/queries/get-financials.ts` (sector
  comparison: `compareWithSector` in `src/domain/market-data/sector-comparison.ts`)
- **Invoke:** MCP `get_financials {"symbol": "COMI", "metrics": ["revenues", "net_income", "roe_%"], "compareToSector": true}` ·
  CLI `thndr get-financials COMI --metrics revenues,net_income,roe_% --compare-to-sector`
- **Goal:** a listed company's financial statements and ratios by period, optionally ranked against its sector the
  way ThndrX does.
- **Input:** `symbol`, `market`, `mode` (`ttm` default: trailing twelve months, comparable across companies and
  seasons; `qoq` single quarters, ThndrX's default view; `yoy` fiscal years), `metrics` (Thndr metric keys; default
  a compact core set: revenues, gross/operating profit, EBITDA, net income, EPS, net interest income, total assets/
  liabilities/equity/debt, customer deposits, loans, CFO, FCFF, margins, ROE, ROA, revenue and EPS growth, BVPS;
  `["all"]` for every metric Thndr reports; Thndr serves no valuation multiples such as `pe_ratio`, `pb_ratio` or
  `ev_ebitda` — ThndrX derives them in the browser, and so does the sector comparison), `periods` (most recent N,
  1–40, default 8; sent as `dataPointCount`), `compareToSector` (default false). `metrics` does not affect the
  comparison, which always covers every metric ThndrX compares.
- **Main flow:**
  1. Resolve the symbol; fetch the company's financials for `mode` and `periods`.
  2. Keep the requested metrics (those the company lacks go to `unavailable`), each with its last `periods` points
     and its latest point.
  3. With `compareToSector`: take the company's marketwatch sector (`eng_desc`) and every company of that sector with
     listed shares; fetch their financials in one batch call; for every ThndrX comparison metric compute the
     company's value and the sector's median/min/max (zero and missing values dropped) and the percentile 1–100
     (100 = best, reversed when lower is better); rate each category with the rounded mean percentile of its rated
     metrics (banded on the unrounded mean). Valuation multiples and free-cash-flow yield are derived against the
     latest period (docs/api/market-data.md §8a). As in ThndrX, the company's own values use the close of the last
     daily candle on or before the end of its latest period (quarters end 31 Mar/30 Jun/30 Sep/31 Dec, years
     31 Dec; daily candles from 3 years ago, 8 for `yoy`), while the peers — the company's own sample entry
     included — use the current marketwatch price. The company's price-based values are therefore usually not in
     the sample, so their percentile can fall slightly outside 1–100 (ThndrX's formula, unclamped).
- **Alternative/error flows:** Thndr has no financials for the company (HTTP 404 "Symbol not found", or an empty
  answer) → `NOT_FOUND` ("Thndr has no financials for X."). No sector in the market snapshot → `sectorComparison:
  null` with a note. The sector batch call fails upstream (429 after the retry, 5xx) → `sectorComparison: null`
  with a note; the statements are still returned. Daily candles empty or failing upstream → the company is valued
  at the current price (`valuationPrice.basis: "currentPrice"`, as ThndrX does) with a note. Candles that do not
  reach back to the period end (Thndr serves about 5 years; only a company whose latest period ended earlier) →
  current price with a note, where ThndrX leaves the multiples empty. Banks: compared the same way, with a note
  that ThndrX does not show this panel for banks. Common errors.
- **Output:** `ticker`, `name`, `currency`, `mode`, `basis` (what the periods mean), `latestPeriod`, `units`,
  `metrics` (`{<key>: {latest: {period, value}, series: [{period, value}]}}`), `unavailable?`, `availableMetrics`,
  and with `compareToSector` `sectorComparison` (`sector`, `companies`, `companiesWithData`, `method`,
  `valuationPrice` (`{period, periodEnd, basis: "periodEndClose" | "currentPrice", price, priceDate, reason?}`),
  `ratings` `[{category, percentile, band}]`, `metrics` `[{key, category, unit, lowerIsBetter, source, value,
  sectorCount, median, min, max, percentile, companyPrice?}]`) and `notes?`. `source` is the Thndr metric key a value
  is read from (`roe_%`) or the formula it is derived with (`price / eps (left out when negative)`); `companyPrice`
  (price-based metrics only: P/E, P/B, EV/EBITDA, P/S, PEG, free-cash-flow yield) is the `valuationPrice.basis`.
  Free-cash-flow yield and CFO/revenue are given in percent (ThndrX shows the bare ratio); this does not change the
  ranks.
- **Thndr endpoints:** (resolve) + `GET web /financials?symbol=&mode=&dataPointCount=`; with `compareToSector`
  also `GET prod /assets-service/assets/marketwatch` (cached 10 s), `GET web /financials?symbols=A,B,…&mode=` and
  `GET krakend /feed/advanced-charts/v2/{id}/trades?resolution=1D` (3 or 8 years, like ThndrX).

## News — `get_news` (`GetNews`)

- **Use case:** `GetNews` (`Query`) in `src/application/market-data/queries/get-news.ts`
- **Invoke:** MCP `get_news {"symbol": "COMI", "limit": 2}` · CLI `thndr get-news COMI [--limit 2] [--page 2] [--locale ar] [--content-chars 0]`;
  market-wide: `thndr get-news`
- **Goal:** recent news and exchange disclosures, for one instrument or market-wide.
- **Input:** `symbol` (optional; omit for market-wide news across Thndr's markets), `market` (only to resolve the
  symbol: market-wide news cannot be filtered by market — the endpoint ignores a `market` parameter and mixes EGX
  and US items, live-verified 2026-10-06), `page` (default 1, 25 per page), `limit` (keep the first N articles of
  the page, 1–25, default 25), `locale` (`en` default, `ar`), `contentChars` (truncate each article's content to N
  characters, default 500, 0 omits it, up to 20000).
- **Main flow:**
  1. Resolve the symbol when given.
  2. Fetch the page of news (newest first).
  3. Drop repeated articles (domain `dedupeNews`): Thndr lists some EGX filings twice, with and without the PDF link
     (live 2026-10-06, e.g. ADIB's 6-month results); same title (ignoring case and spacing), publication time and
     tickers → one article, the copy with a link first, then the one with more content. Articles without a title or a
     time are never merged. Duplicates are removed within the page only (none were seen across a page boundary).
  4. Keep the first `limit` articles; truncate content longer than `contentChars` (adds `…` and
     `contentTruncated: true`).
- **Alternative/error flows:** a page past the last one → empty `items`, `hasMore: false`. Common errors.
- **Output:** `ticker` (or null), `locale`, `page`, `total` (Thndr's count across pages, duplicates included),
  `hasMore` (another page exists, or `limit` left articles of this page out), `duplicatesRemoved`, `items`
  (`[{id, title, content?, contentTruncated?, source, link, publishedAt, market, tickers}]`). Many EGX disclosures
  have empty content: their text is the PDF at `link`.
- **Thndr endpoints:** (resolve) + `GET prod /api/post/news/?asset_id=&locale=&page=`.

## Egypt economic indicators — `get_economic_indicators` (`GetEconomicIndicators`)

- **Use case:** `GetEconomicIndicators` (`Query`) in `src/application/market-data/queries/get-economic-indicators.ts`
- **Invoke:** MCP `get_economic_indicators {"points": 6}` · CLI `thndr get-economic-indicators --points 6`
- **Goal:** Egypt's macro backdrop as ThndrX shows it: inflation, CBE rates, treasury-bill yields, unemployment, GDP.
- **Input:** `points` (latest N points of each series, 1–500, default 12).
- **Main flow:**
  1. Fetch Thndr's macro data (one call).
  2. Keep the latest `points` of each series (series are sorted oldest first).
- **Alternative/error flows:** common errors.
- **Output:** `description`, `extractedAt` (when Thndr extracted the data), `sources` (Thndr's description of each
  series), `overview` (`headlineInflationYearly`, `coreInflationYearly`, `unemployment`, `depositRate`,
  `lendingRate`, `treasuryBills12m`: `{value, date, period, change}`), `gdp` (`gdpEgp`, `gdpUsd`, `gdpGrowthEgp`,
  `gdpGrowthUsd`), `inflationYearly` / `inflationMonthly` (`{date, headline, core, goodsAndServices,
  fruitsAndVegetables}`), `overnightRates` (`{date, depositRate, lendingRate}`), `treasuryBills` (`{date, oneMonth,
  threeMonths, sixMonths, nineMonths, twelveMonths}`), `unemployment` (`{period, year, quarter, rate}`), `units`.
  Values are percent; `change` is Thndr's `growth` (the change from the previous reading).
- **Thndr endpoints:** `GET web /macros`.

---

## Discovery (mobile-app endpoints, [ADR 0021](../adr/0021-all-thndr-markets.md))

These use cases read the `discovery` dependency (`DiscoveryRepository`, adapter `ThndrDiscoveryRepository`), built
from the Thndr Android app's endpoints ([api/mobile-app.md](../api/mobile-app.md) §1.3, §2.7, §2.8, §4.B), all
live-verified read-only on 2026-10-06. Host `app` = `https://prod.thndr.app/krakend-thndr-app` (the app's KrakenD
gateway, same full-access token; its embedded `error_*` keys become `UPSTREAM_ERROR`). Markets outside a feature's
list fail fast with `FEATURE_DISABLED` (`requireMarketFeature`) without calling Thndr.

## Markets — `get_markets` (`GetMarkets`)

- **Use case:** `GetMarkets` (`Query`) in `src/application/market-data/queries/get-markets.ts`
- **Invoke:** MCP `get_markets` · CLI `thndr get-markets`
- **Goal:** learn which Thndr markets the account can use and which thndr-mcp features work in each.
- **Input:** none.
- **Main flow:**
  1. Fetch the user's visible markets (one call).
  2. Map Thndr's names to markets (`abudhabi` → `uae`); names thndr-mcp does not serve (e.g. `tdwl`) go to
     `otherThndrMarkets`.
  3. Add each market's profile (exchange name, currency, time zone) and its capability table (`marketSupports`).
- **Alternative/error flows:** common errors.
- **Output:** `defaultMarket`, `markets` (`[{market, name, currency, timeZone, restricted, restrictionReason,
  supports, lacks}]`, `supports`/`lacks` = feature keys), `otherThndrMarkets`, `features` (key → what it means),
  `note` (search, details, news and dividends work everywhere; use `egypt`/`us` for the simulator's instruments).
- **Thndr endpoints:** `GET prod /compliance-service/eligibilities/v2/visible-markets`.

## Market movers — `get_market_movers` (`GetMarketMovers`)

- **Use case:** `GetMarketMovers` (`Query`) in `src/application/market-data/queries/get-market-movers.ts`
- **Invoke:** MCP `get_market_movers {"market": "us", "type": "gainers", "period": "1W"}` ·
  CLI `thndr get-market-movers [--market us] [--type gainers] [--period 1W] [--limit 5]`
- **Goal:** Thndr's top gainers and losers of a market over a period.
- **Input:** `market` (`egypt` default, `us`), `type` (`gainers`, `losers`, `both` default), `period` (`1D` default,
  `1W`, `1M`, `6M`, `1Y`), `limit` (per list, 1–50, default 10).
- **Main flow:**
  1. Check the market ranks movers (Egypt, US; the UAE answers 500/422 live).
  2. Fetch each requested ranking with the instruments' feed (in parallel for `both`).
- **Alternative/error flows:** UAE or simulator → `FEATURE_DISABLED`; common errors.
- **Output:** `market`, `period`, `updatedAt` (latest ranking time, or null — US rankings have none), `gainers` and/or
  `losers` (`[{ticker, name, assetClass, sector, currency, price, changePercent, tradable, instrumentId,
  returnPercent}]`). `returnPercent` is the period return; `changePercent` today's change. US lists can include
  instruments Thndr does not let you trade (`tradable: false`, live 2026-10-06).
- **Thndr endpoints:** `GET prod /assets-service/assets/rank?limit&market&type=GAINERS|LOSERS&duration&include_feed=true&feed_detail=true`.

## Trending instruments — `get_trending` (`GetTrending`)

- **Use case:** `GetTrending` (`Query`) in `src/application/market-data/queries/get-trending.ts`
- **Invoke:** MCP `get_trending {"market": "uae"}` · CLI `thndr get-trending [--market us] [--stocks-only] [--limit 5]`
- **Goal:** what is trending on Thndr in a market (the app's Explore tab).
- **Input:** `market` (`egypt` default, `us`, `uae`), `stocksOnly` (default false), `limit` (1–20, default 10).
- **Main flow:**
  1. Fetch the trending asset ids from the gateway.
  2. Name each through `InstrumentResolver` (asset details, cached), in parallel — bounded by `limit` ≤ 20.
- **Alternative/error flows:** simulator → `FEATURE_DISABLED`; an instrument whose details fail keeps its id with
  null fields; common errors.
- **Output:** `market`, `stocksOnly`, `items` (`[{rank, instrumentId, ticker, name, assetClass, sector}]`). No prices:
  use `get_price_snapshot`.
- **Thndr endpoints:** `GET app /explore/v1/assets/trending?market=egypt|us|abudhabi&count[&asset_class=STOCK]` +
  (resolve) `GET prod /assets-service/assets/{id}`.

## Tags (themes) — `get_tags` (`GetTags`)

- **Use case:** `GetTags` (`Query`) in `src/application/market-data/queries/get-tags.ts`
- **Invoke:** MCP `get_tags {"market": "us"}` · CLI `thndr get-tags [--market us]`
- **Goal:** Thndr's curated instrument groups for a market ("Sharia", "Gold Funds", "Dividend Players"…).
- **Input:** `market` (`egypt` default, `us`).
- **Main flow:** fetch the market's tags (one page of 100; Thndr has about 20 per market), skipping hidden ones.
- **Alternative/error flows:** UAE or simulator → `FEATURE_DISABLED` (not verified for the UAE); common errors.
- **Output:** `market`, `tags` (`[{id, name, slug, about, instrumentCount, featured}]`), in Thndr's order.
  `get_instrument_details` shows the tags of one instrument.
- **Thndr endpoints:** `GET prod /assets-service/tags?page_count=100&market=`.

## Tag instruments — `get_tag_instruments` (`GetTagInstruments`)

- **Use case:** `GetTagInstruments` (`Query`) in `src/application/market-data/queries/get-tag-instruments.ts`
- **Invoke:** MCP `get_tag_instruments {"tag": "sharia"}` · CLI `thndr get-tag-instruments sharia [--market us] [--page 2] [--limit 50]`
- **Goal:** the instruments of one tag — e.g. every Sharia-compliant EGX stock.
- **Input:** `tag` (id such as `157`, slug or name; required), `market` (`egypt` default, `us`), `page` (default 1),
  `limit` (page size, 1–50, default 20).
- **Main flow:**
  1. A numeric `tag` is used as the id; otherwise the market's tags are fetched and matched (`findTag`: id, slug or
     name ignoring case and separators, else a unique partial name).
  2. Fetch the tag with one page of its instruments and their feed.
- **Alternative/error flows:** no tag matches → `NOT_FOUND` listing the market's tags; unknown id → `NOT_FOUND`;
  a page past the last one → the tag with no instruments (a 404 there is re-checked against page 1);
  UAE or simulator → `FEATURE_DISABLED`; common errors.
- **Output:** `market`, `tag` (as in `get_tags`), `page`, `pageSize`, `total` (the tag's instrument count), `hasMore`,
  `instruments` (`[{ticker, name, assetClass, sector, currency, price, changePercent, tradable, instrumentId}]`).
- **Thndr endpoints:** (`GET prod /assets-service/tags?market=` for a slug or name) +
  `GET prod /assets-service/tags/{id}?market&page_count&page&include_feed=true&feed_detail=true`.

## Dividends — `get_dividends` (`GetDividends`)

- **Use case:** `GetDividends` (`Query`) in `src/application/market-data/queries/get-dividends.ts`
- **Invoke:** MCP `get_dividends {"symbol": "COMI"}` · CLI `thndr get-dividends COMI [--page 2] [--limit 20]`
- **Goal:** an instrument's dividend history and announced dividends.
- **Input:** `symbol`, `market` (to resolve the symbol; any market), `page` (default 1), `limit` (page size, 1–50,
  default 10).
- **Main flow:**
  1. Resolve the symbol.
  2. Fetch one page of its dividends (newest first).
- **Alternative/error flows:** no dividends → empty list (e.g. NVDA, FAB live 2026-10-06); a page past the last one →
  empty list; common errors.
- **Output:** `ticker`, `name`, `page`, `pageSize`, `total`, `hasMore`, `dividends` (`[{id, type, status, recordDate,
  cashPerShare | bonusSharesPerShare | ratio, currency, frequency, couponNumber, distributions: [{date,
  cashPerShare | bonusSharesPerShare | ratio}]}]`; each distribution uses the dividend's unit).
  `type` is `CASH` (`cashPerShare` in `currency`) or `STOCK` (`bonusSharesPerShare`: 0.1 = one new share for ten);
  `status` is `UPCOMING`, `ONGOING` or `PAST`.
- **Thndr endpoints:** (resolve) + `GET prod /assets-service/assets/{id}/dividends?page&page_count`.
