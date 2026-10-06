# Market Data use cases

Code: `src/application/market-data/use-cases.ts`; tools in `src/interface/mcp/market-data-tools.ts`.
Domain: [domains/market-data.md](../domains/market-data.md). API: [api/market-data.md](../api/market-data.md).

**Actor** for every use case: the LLM agent acting on behalf of the Thndr account holder.

**Common to all use cases**

- **Preconditions:** a Thndr session exists (every market-data endpoint is called with the full-access token).
- **Input conventions:** `market` is `egypt` (default) or `us`; `symbol` is a ticker (`COMI`, any case) or a Thndr
  asset id (UUID), resolved by `InstrumentResolver`.
- **Common error flows:**
  - No session → `NOT_AUTHENTICATED`; refresh credential rejected → `SESSION_EXPIRED` (re-approve).
  - Invalid ticker/asset id format or out-of-range argument → `VALIDATION_ERROR`.
  - Ticker with no exact match → `NOT_FOUND` (with up to five suggestions).
  - Thndr HTTP error, network error, KrakenD embedded error or unexpected payload → `UPSTREAM_ERROR`.
- Hosts: `prod` = `https://prod.thndr.app`, `krakend` = `https://prod.thndr.app/krakend-thndr-x`.

---

## Search instruments — `search_instruments` (`SearchInstruments`)

- **Goal:** find instruments by ticker or company name (English or Arabic).
- **Input:** `query` (non-empty), `market`, `limit` (1–50, default 20).
- **Main flow:**
  1. Search Thndr.
  2. Remember every hit in the resolver cache (later ticker lookups are free).
  3. Return the first `limit` results.
- **Alternative/error flows:** empty query → `VALIDATION_ERROR`; common errors.
- **Output:** `{ results: Instrument[] }` — id, ticker, name, assetClass, market, currency, sector, board,
  tradable, suspended, priceDecimals.
- **Thndr endpoints:** `GET prod /assets-service/assets/search`.

## Instrument details — `get_instrument_details` (`GetInstrumentDetails`)

- **Goal:** company profile and listing details of one instrument.
- **Input:** `symbol`, `market`.
- **Main flow:**
  1. Resolve the symbol to an asset id.
  2. Fetch the asset details (always fresh).
- **Alternative/error flows:** common errors.
- **Output:** `Instrument` including `description` and `logoUrl` when Thndr sends them.
- **Thndr endpoints:** resolve (`/assets-service/assets/search` or cache) + `GET prod /assets-service/assets/{id}`.

## Price snapshot — `get_price_snapshot` (`GetPriceSnapshot`)

- **Goal:** current quotes for up to 50 instruments.
- **Input:** `symbols` (1–50), `market`.
- **Main flow:**
  1. Resolve all symbols and load the market snapshot in parallel (snapshot cached 10 s).
  2. Pick each instrument's row from the snapshot.
- **Alternative/error flows:**
  - 0 or > 50 symbols → `VALIDATION_ERROR`.
  - Any unresolvable symbol → `NOT_FOUND` for the whole call.
  - Resolved but absent from the snapshot (e.g. an index) → listed in `missing`.
- **Output:** `quotes` (last, previousClose, open/high/low, change, changePercent, bid/ask and sizes, volume,
  value, trades, lower/upper price limit, 52-week high/low, P/E, EPS, dividend yield, listed shares, market cap,
  30-day average volume, suspended, lastTradeAt) and `missing` (tickers).
- **Thndr endpoints:** resolve + `GET prod /assets-service/assets/marketwatch`.

## Price history — `get_price_history` (`GetPriceHistory`)

- **Goal:** OHLCV candles for charting or indicators.
- **Input:** `symbol`, `market`, `resolution` (`1min`, `5min`, `10min`, `1h`, `1d` default, `1w`), and either
  `bars` (1–2000, default 100) or `from`/`to` (ISO-8601).
- **Main flow:**
  1. `to` defaults to now. Without `from`, derive it from `bars` × resolution, over-fetching (×4 intraday and
     `1h`, ×1.6 daily/weekly) because markets are closed most of the time.
  2. Validate and clamp the window to the last 5 years up to now.
  3. Resolve the symbol, fetch candles, sort oldest first.
  4. Without `from`, keep only the last `bars` candles.
- **Alternative/error flows:** `from ≥ to`, invalid dates, or a window entirely outside the last 5 years →
  `VALIDATION_ERROR`; malformed candles are dropped silently; common errors.
- **Output:** `ticker`, `resolution`, `from`, `to` (effective window), `candles` (`time`, `open`, `high`, `low`,
  `close`, `volume`).
- **Thndr endpoints:** resolve + `GET krakend /feed/advanced-charts/v2/{id}/trades`.

## Market depth — `get_market_depth` (`GetMarketDepth`)

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

- **Goal:** filter and rank every instrument — top gainers/losers, most active, unusual volume, value stocks,
  a sector.
- **Input:** `market`, `sector` (substring), `min_price`, `max_price`, `min_change_percent`,
  `max_change_percent`, `min_value`, `min_relative_volume` (%), `max_pe_ratio`, `min_dividend_yield` (%),
  `include_suspended` (default false), `sort_by` (`changePercent` default, `value`, `volume`, `relativeVolume`,
  `marketCap`, `last`, `dividendYieldPercent`, `peRatio`), `order` (`desc` default), `limit` (1–100, default 20).
- **Main flow:**
  1. Load the market snapshot (cached 10 s).
  2. Add relative volume to each row; apply the filters (null fields fail their filter).
  3. Sort (nulls last) and take `limit`.
- **Alternative/error flows:** common errors. No matches → `total: 0`, empty `results`.
- **Output:** `market`, `total` (matches before the limit), `results` (quotes + `relativeVolume`).
- **Thndr endpoints:** `GET prod /assets-service/assets/marketwatch`.
