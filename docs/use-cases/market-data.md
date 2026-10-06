# Market Data use cases

Code: one `Query` class per use case in `src/application/market-data/queries/`; shared `InstrumentResolver`,
`MarketQuotesCache` and `IndexMembership` in `src/application/market-data/services/` — Market Data's Open Host Service, which the
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
- Hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`.

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
  `NOT_FOUND`; a saved screener with a filter thndr-mcp cannot evaluate → `VALIDATION_ERROR` naming it; unknown
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
  per `INDX` row (`constituents`, cached 6 h).

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
