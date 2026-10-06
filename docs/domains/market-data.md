# Market Data (core subdomain)

Everything about the market itself — instruments, live quotes, history, order book, tape and the trading session —
plus screening of the whole-market snapshot. It is upstream of [Portfolio](portfolio.md) and
[Engagement](engagement.md), which use its `InstrumentResolver`.

Code: `src/domain/market-data/` (repository interface in `repository.ts`), `src/application/market-data/`,
`src/infrastructure/repositories/thndr/market-data-repository.ts` (+ `data-sources/thndr/dto/market-data.ts`,
`repositories/thndr/translators/market-data.ts`); use-case classes in `src/application/market-data/queries/`,
shared `InstrumentResolver` and `MarketQuotesCache` in `src/application/market-data/services/`.
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
| **Board** | EGX sub-market (`feed.market_id`): `NOPL` main board, `OOTC` over-the-counter, `SME`, `INDX` indices, `FNDS` funds. |
| **Suspended** | Trading halted on the symbol (Thndr `symbol_state === "S"`). |
| **Quote** | Point-in-time trading snapshot of one instrument: last, previous close, OHLC, change, bid/ask with sizes, volume, value, trades, daily price limits, 52-week range, P/E, EPS, dividend yield, listed shares, market cap, 30-day average volume, last trade time. |
| **Last price** | `last_trade_price` when > 0, else `close_price` (0 means no trade yet today), as ThndrX does. |
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

## Model and invariants

| Element | Kind | Invariants / behaviour |
| --- | --- | --- |
| `AssetId` | value object | Must be a UUID (`8-4-4-4-12` hex); normalised to lower-case. `AssetId.isAssetId(raw)` tests without throwing. |
| `Market` | enum + `parseMarket` | Empty → `egypt`; unknown → `VALIDATION_ERROR`. |
| `AssetClass` | enum + `parseAssetClass` | Unknown wire values become `UNKNOWN` (never fails). |
| `Instrument` | read model | `id`, `ticker`, `name`, `assetClass`, `market`, `currency` (`EGP`/`USD`/null), `sector`, `board`, `tradable`, `suspended`, `priceDecimals` (2 or 3 on EGX), optional `description`, `logoUrl`. |
| `Quote` | read model | Every numeric field nullable (Thndr often omits them). `relativeVolume(quote)` returns null without a 30-day average. |
| `Candle` | value (`createCandle`) | All of OHLCV finite, valid time, `high ≥ low`. Frozen. |
| `historyWindow(from, to, now)` | domain service | `from < to`; clamps to `[now − 5 years, now]`; empty after clamping → `VALIDATION_ERROR`. |
| `OrderBook` | read model | Bids best (highest) first, asks best (lowest) first. `spread(book)` is null when a side is empty or best bid ≤ 0. |
| `TapeTrade` | read model | Each trade carries the cursor used to page further back. |
| `MarketSession` | read model | `market`, `isOpen`, `opensAt`, `closesAt` (open/close nullable). |

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

### `MarketQuotesCache`
- Caches the marketwatch snapshot per market for **10 s** (default `ttlMs`). One upstream call serves every
  snapshot, screen and mover request in that window.
- Caches the *promise*, so concurrent callers share one request; a failed request is evicted so the next call
  retries (a newer entry is never evicted).

## Screening semantics (`ScreenMarket`)

ThndrX evaluates screeners client-side on marketwatch rows; we do the same on the cached snapshot.

- Suspended instruments are excluded unless `includeSuspended`.
- `sector`: case-insensitive *substring* match on the quote's sector (EGX sector names such as "Banks",
  "Real Estate").
- Range filters: price (`minPrice`/`maxPrice` on last), change % (`min/maxChangePercent`), `minValue` (traded
  value), `minRelativeVolume` (%), `maxPeRatio`, `minDividendYield` (%). A row whose field is **null fails** any
  filter on that field.
- Sort by `changePercent` (default), `value`, `volume`, `relativeVolume`, `marketCap`, `last`,
  `dividendYieldPercent` or `peRatio`; `desc` by default. Nulls always sort last.
- Returns `total` matching rows and the first `limit` (default 20, max 100), each with `relativeVolume`.
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
`ThndrMarketDataRepository` (`src/infrastructure/repositories/thndr/market-data-repository.ts`). Use cases receive
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

All on `https://prod.thndr.app`; KrakenD responses pass through `assertNoKrakendError`.
