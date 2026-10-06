# Market Data use cases

Code: one `Query` class per use case in `src/application/market-data/queries/`; shared `InstrumentResolver`,
`MarketQuotesCache` and `IndexMembership` in `src/application/market-data/services/`; fundamentals, news and macro
data come from the `research` dependency (`ResearchRepository`, ADR 0018) — Market Data's Open Host Service, which the
Portfolio and Engagement use cases also consume
([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)). MCP tools and CLI commands are generated from these
classes; CLI positionals come from `src/presentation/cli/positionals.ts`.
Domain: [domains/market-data.md](../domains/market-data.md). API: [api/market-data.md](../api/market-data.md).

**Actor** for every use case: the LLM agent (MCP) or a user at a terminal (CLI `thndr`), acting on behalf of the
Thndr account holder. Both run the same use-case class through `runAndPresent`
([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); add `--json` to a CLI command to get the exact MCP JSON.

**Common to all use cases**

- **Preconditions:** a Thndr session exists (every market-data endpoint is called with the full-access token).
- **Input conventions:** `market` is `egypt` (default) or `us`; `symbol` is a ticker (`COMI`, any case) or a Thndr
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
  belongs to, e.g. `["EGX30", "EGX30CAPPED"]`; `[]` for none).
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
- **Goal:** is the market open now, today's session times and index levels.
- **Input:** `market`.
- **Main flow:**
  1. In parallel: market status + hours, and market indicators.
  2. Map indicators to index summaries.
- **Alternative/error flows:** hours failure → `opensAt`/`closesAt` null; indicators failure → `indices: []`;
  status failure → `UPSTREAM_ERROR`; auth errors as usual.
- **Output:** `market`, `isOpen`, `opensAt`, `closesAt`, `indices` (`ticker`, `level`, `changePercent`,
  `previousClose`). EGX regular session: Sunday–Thursday 10:00–14:30 Africa/Cairo.
- **Thndr endpoints:** `GET prod /market-service/markets/status`, `GET prod /market-service/markets/hours`,
  `GET prod /assets-service/assets/market-indicators`.

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
- **Input:** `index` (optional; exact symbol ignoring case and separators, or a unique prefix: `egx70` →
  `EGX70-EWI`), `market`, `sortBy` (`marketCap` default, `changePercent`, `value`, `volume`, `last`, `ticker`),
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
  membership is cached 6 h (an answer without index rows, or with an index without members, is not cached).

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
     latest close. Null when history does not reach back that far.
  5. Annualised historical volatility for the last 30, 90 and 252 sessions: sample standard deviation of daily log
     returns × √252, in percent (null with too few sessions).
  6. 52-week high/low from the daily highs/lows of the last 12 months; maximum drawdown on closes from the 1Y base
     close.
- **Alternative/error flows:** common errors. No candles → nulls and empty lists.
- **Output:** `ticker`, `name`, `currency`, `asOf` (day of the latest close), `lastClose`, `returns`
  (`[{period, startDate, baseDate, baseClose, returnPercent}]`), `volatility` (`[{window, tradingDays,
  annualisedPercent}]`), `week52` (`{high, highDate, low, lowDate}`), `maxDrawdown1Y` (`{percent, peakDate,
  troughDate}`), `thndrOneYearReturn` (`{percent, direction}` or null), `history` (`firstDate`, `sessions`), `method`.
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
  `["all"]` for every metric Thndr reports), `periods` (most recent N, 1–40, default 8; sent as `dataPointCount`),
  `compareToSector` (default false).
- **Main flow:**
  1. Resolve the symbol; fetch the company's financials for `mode` and `periods`.
  2. Keep the requested metrics (those the company lacks go to `unavailable`), each with its last `periods` points
     and its latest point.
  3. With `compareToSector`: take the company's marketwatch sector (`eng_desc`) and every company of that sector with
     listed shares; fetch their financials in one batch call; for every ThndrX comparison metric compute the
     company's value and the sector's median/min/max (zero and missing values dropped) and the percentile 1–100
     (100 = best, reversed when lower is better); rate each category with the rounded mean percentile of its rated
     metrics. Valuation multiples use today's price against the latest period (docs/api/market-data.md §8a).
- **Alternative/error flows:** Thndr has no financials for the company (HTTP 404 "Symbol not found", or an empty
  answer) → `NOT_FOUND` ("Thndr has no financials for X."). No sector in the market snapshot → `sectorComparison:
  null` with a note. Banks: compared the same way, with a note that ThndrX does not show this panel for banks.
  Common errors.
- **Output:** `ticker`, `name`, `currency`, `mode`, `basis` (what the periods mean), `latestPeriod`, `units`,
  `metrics` (`{<key>: {latest: {period, value}, series: [{period, value}]}}`), `unavailable?`, `availableMetrics`,
  and with `compareToSector` `sectorComparison` (`sector`, `companies`, `companiesWithData`, `method`, `ratings`
  `[{category, percentile, band}]`, `metrics` `[{key, category, unit, lowerIsBetter, value, sectorCount, median, min,
  max, percentile}]`) and `notes?`. Free-cash-flow yield and CFO/revenue are given in percent (ThndrX shows the bare
  ratio); this does not change the ranks.
- **Thndr endpoints:** (resolve) + `GET web /financials?symbol=&mode=&dataPointCount=`; with `compareToSector`
  also `GET prod /assets-service/assets/marketwatch` (cached 10 s) and `GET web /financials?symbols=A,B,…&mode=`.

## News — `get_news` (`GetNews`)

- **Use case:** `GetNews` (`Query`) in `src/application/market-data/queries/get-news.ts`
- **Invoke:** MCP `get_news {"symbol": "COMI"}` · CLI `thndr get-news COMI [--page 2] [--locale ar] [--content-chars 0]`;
  market-wide: `thndr get-news`
- **Goal:** recent news and exchange disclosures, for one instrument or market-wide.
- **Input:** `symbol` (optional; omit for market-wide news across Thndr's markets), `market` (to resolve the
  symbol), `page` (default 1, 25 per page), `locale` (`en` default, `ar`), `contentChars` (truncate each article's
  content to N characters, default 500, 0 omits it, up to 20000).
- **Main flow:**
  1. Resolve the symbol when given.
  2. Fetch the page of news (newest first).
  3. Truncate content longer than `contentChars` (adds `…` and `contentTruncated: true`).
- **Alternative/error flows:** a page past the last one → empty `items`, `hasMore: false`. Common errors.
- **Output:** `ticker` (or null), `locale`, `page`, `total` (Thndr's count across pages), `hasMore`, `items`
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
