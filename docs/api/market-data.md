# ThndrX private API — Market Data & User Lists spec

Source: de-minified Next.js bundles of https://x.thndr.app (build current as of 2026-10-06).
File references are to the de-minified ThndrX bundle of deployment `dpl_56Z6BSAwsido5k8jnqCao8QoenYw` (regenerate with `npm run sync:api`).

Legend: **[C]** = confirmed directly from code (call site / literal); **[I]** = inferred from UI usage
(field names seen being read, types guessed); **[P]** = confirmed by live unauthenticated probe.

## Contents
0. Transport, clients, auth, interceptors · 1. Instruments (search, details, marketwatch) · 2. Price history (line charts, **OHLCV candles `/feed/advanced-charts/v2/{id}/trades`**) · 3. Market depth & trades book · 4. Watchlists · 5. Screeners & price alerts · 6. Realtime (Firebase RTDB) · 7. Feature flags · 8. Misc (market-indicators, rank2, recommendations, securities v1, notifications, tags, market status/hours, news, unleash, tvcharts) · 9. `/thndrx/*` analyst content (therumble.app)

---

## 0. Transport, clients, auth, interceptors

### 0.1 Axios clients (module `2938`, `chunks_3515-3f5b9465a524d3e5.js:9-466`) [C]

| export | internal | baseURL | auth (request interceptor) | response interceptor |
|---|---|---|---|---|
| `aP` | `J` | `https://prod.thndr.app` | `m` → `Authorization: Bearer <FULL_ACCESS token>` (auto-refresh via `POST /api/auth/refresh`) | `M.r4` (log only) + 401/403 refresh-and-retry `_` |
| `Kc` | `ee` | `https://prod.thndr.app/krakend-thndr-x` | same full-access Bearer | **`M.p4`** (krakend error-key detection) + `_` |
| `kQ` | `et` | `https://prod.thndr.app` | `x` → `Bearer <LIMITED_ACCESS token>` (created via `POST /auth-service/v2/tokens/limited-access` with firebase token in body) | `M.r4` |
| `pu` | `er` | `https://prod.thndr.app` | none | `M.r4` |
| `th` | `en` | `https://prod.thndr.app` | firebase ID token injected into JSON body as `credentials.firebase_token` (POST/PATCH/PUT only) | `M.r4` |
| `hC` | `ea` | `/api` (= `https://x.thndr.app/api`) | `Authorization: Bearer <firebase ID token>` | `M.r4` |
| `Z$` | `es` | `/api` | none | `M.r4` |
| `zC` | `ec` | `/api` | full-access Bearer (same as `aP`) | `M.r4` + `_` |
| `VA` | `ei` | `https://therumble.app/api` | `Bearer <Rumble token>` (minted via `POST /api/auth/rumble-exchange` on x.thndr.app) + advisory gate `K` | `M.r4` + rumble 401/403 retry — **all `/thndrx/*` analyst content goes here (section 9)** |
| `yS` | `eu` | `https://therumble.app/api` | none | `M.r4` |

Headers added to every request [C]:
- `X-Correlation-ID: <random id>` (`M.Ff`, module 61199)
- `x-thndrx-runtime-version: <major>.<minor>.<patch>` (`z`)
- Optional per-request pseudo-headers consumed by interceptor `I`:
  - `includeLanguageHeader: true` → replaced by `X-Language: <locale>` (`"ar"` default, or `"en"`).
    Used by `GET /assets-service/assets/{id}` (localized `about`, `industry`, …).
  - `authorizationAuth: true` → `Authorization: Auth <token>` instead of `Bearer`.

Evidence (`chunks_3515…js:330`):
```js
async function I(e) {
  return e.headers.authorizationAuth ? (e.headers.authorization = `Auth ${E.L.getToken({type:E.k.FULL_ACCESS})}`, delete e.headers.authorizationAuth)
    : e.headers.authorization = `Bearer ${E.L.getToken({type:E.k.FULL_ACCESS})}`,
    e.headers.includeLanguageHeader && (e.headers["X-Language"] = y.I.getItem("locale") || "ar", delete e.headers.includeLanguageHeader), e
}
```

### 0.2 Response interceptors (module `61199`, `chunks_3515…js:843-900`) [C]

- `M.r4` (`d`) — **logging only**; returns the axios response untouched. **No envelope unwrapping and no case conversion** anywhere: all payloads are consumed as raw `snake_case` JSON via `(await client.get(...)).data`.
- `M.p4` (`p`) — used only on the **krakend** client `Kc`. Krakend aggregates several backends and returns HTTP 200 even when a backend fails; the failure appears as an extra top-level key. If `response.data` contains one of these keys it is converted into a rejected `AxiosError`:
  ```
  error_error_feed-historicals-service, error_price_alerts, error_asset_day_snapshot, error_asset_price,
  error_asset_metadata, error_full_trades, error_partial_sells, error_trading_metrics, error_security_position,
  error_get_clouds, error_transfer_types_clouds, error_calculate_transfer_fees, error_external_transfer,
  error_update_cloud_transfer_request, error_transactions_clouds, error_clouds_stats, error_get_notifications,
  error_patch_notifications_batch, error_get_notifications_has_unread, error_patch_notifications_read_all
  ```
  Each such value looks like `{ http_status_code: number, http_body: string /* JSON: {"detail":{"msg":..,"type":..}} */ }`;
  the error message/type are taken from `JSON.parse(http_body).detail.msg/.type` and `status = http_status_code`.
  **An MCP client calling krakend endpoints MUST replicate this check.**
- `M.lq` (`S`) — error logger, rejects.
- Request URLs starting with `/runtime`, `/assets-service/market-depth/`, `/assets-service/assets/marketwatch`, `/market-service/markets/status` are logged at debug level only (high-frequency polling endpoints).

### 0.3 Error envelope [P]
Unauthenticated probe of `GET https://prod.thndr.app/assets-service/assets/search?...`, `/assets-service/assets/marketwatch?market=egypt`, `/assets-service/assets/{id}`:
```
HTTP 401
{"detail": {"msg": "Missing token", "type": "MISSING_TOKEN"}}
```
=> **All market-data endpoints require a full-access Bearer token; none are public.**

```ts
interface ApiError { detail: { msg: string; type: string } }   // [P]
```
Known refresh error types: `INVALID_REFRESH_TOKEN | MISSING_REFRESH_TOKEN | EXPIRED_REFRESH_TOKEN` [C].
HTTP 429 is used for rate-limiting (charts endpoint retries with backoff 8–12 s ×1.5, max 20 s, total 30 s) [C].

### 0.4 Shared enums [C]

```ts
// module 51487 (chunks_3073…js:512) — the `market` query param everywhere
enum Market { SIMULATOR = "simulator", EGYPT = "egypt", US = "us", UAE = "adsm", ADX = "abudhabi" }

// module 18291 (chunks_3073…js:102)
enum AssetClass { STOCK = "STOCK", ETF = "ETF", INDEX = "INDEX", MANAGED_FUND = "FUND" }
enum FeedProvider { EGX = "EGX", ALPACA = "Alpaca", EGYPTIAN_MUTUAL_FUNDS = "Egyptian Mutual Funds" }
// asset.feed.market_id (EGX sub-market / board)
enum MarketId { OOTC = "OOTC", NOPL = "NOPL", SME = "SME", INDX = "INDX", FNDS = "FNDS", ADSM = "adsm" }

// currency (module in chunks_3073…js:349 `mE`) — numeric or string in payloads
const Currency = { 0: "points", 1: "egp", 2: "usd", EGP: "egp", USD: "usd", points: "points" };

// symbol_state: "S" = suspended (used: `stats.symbol_state === "S"`, `symbol_state === "S"` → isSuspended) [C]; other values unknown (likely "A" active) [I]

// EGX sector names (value of `eng_desc` on marketwatch rows; used by screeners `eng_desc` StringArray filter) — lazy_*/chunk enum `b`
enum Sector {
  ContractingConstruction = "Contracting & Construction Engineering",
  HealthCarePharmaceuticals = "Health Care & Pharmaceuticals",
  NonBankFinancialServices = "Non-bank financial services",
  TravelLeisure = "Travel & Leisure",
  ItMediaCommunicationServices = "IT , Media & Communication Services",
  TradeDistributors = "Trade & Distributors",
  EducationServices = "Education Services",
  RealEstate = "Real Estate",
  Banks = "Banks",
  ShippingAndTransportation = "Shipping & Transportation Services",
  IndustrialGoodsServicesAndAutomobiles = "Industrial Goods , Services and Automobiles",
  FoodBeveragesAndTobacco = "Food, Beverages and Tobacco",
  TextileDurableGoods = "Textile & Durables",
  EnergySupportServices = "Energy & Support Services",
  Utilities = "Utilities",
  BasicResources = "Basic Resources",
  BuildingMaterials = "Building Materials",
  PaperPackaging = "Paper & Packaging",
}
// Marketwatch grouping (lazy_5139…js:30): "allStocks" | "bySector" | "byIndex"
```

Constants (module 69281): default selected stock `COMI` with asset id `1923d036-45ad-480b-8c6b-1d1296862f6e` [C].
Asset ids are UUIDs; the TradingView datafeed lower-cases them (`e.toLowerCase()`).

Market session config (module 36941, `chunks_2987…js:3405`) [C] — used by charts, *hard-coded client side*:
```
egypt / default / NOPL : exchange "EGX",     tz "Africa/Cairo", session "1;1000-1430:12345" (Sun–Thu 10:00–14:30), holidays "20260412,20260413"
egypt / OOTC          : exchange "EGX-OTC", tz "Africa/Cairo", session "2;1200-1230:24"
simulator             : exchange "SIM",     tz "Africa/Cairo", session "1;1000-1430:12345"
```
(TradingView day digits: 1=Sun … 7=Sat.)

---

## 1. Instruments / assets

### 1.1 Search — `GET /assets-service/assets/search` [C]
- Client `aP` (prod.thndr.app, full-access Bearer).
- Query string is built by template literal (not URL-encoded by the app!):
  `?query=${q}&market=${market}&include_feed=true&feed_detail=true`
- Enabled only when query non-empty; results cached 60 s. The UI filters out `asset_class === "FUND"`, keeps max 50.

Evidence `chunks_2772-e89a73a54fbbb643.js:179`:
```js
} = await i.aP.get(`/assets-service/assets/search?query=${e}&market=${t}&include_feed=true&feed_detail=true`);
return n?.assets?.filter(e => e.asset_class !== a.A.MANAGED_FUND)
```
```ts
interface AssetSearchResponse { assets: AssetSummary[] }                 // [C] key `assets`
interface AssetSummary {                                                // [I] fields used: id, symbol, name, asset_class
  id: string;            // asset UUID (used as assetId)
  symbol: string;        // e.g. "COMI"
  name: string;
  asset_class: AssetClass;
  market?: Market;
  feed?: AssetFeed;      // present because include_feed=true (see 1.2)
  [k: string]: unknown;
}
```

### 1.2 Asset details — `GET /assets-service/assets/{assetId}` [C]
- Client `aP`. Header pseudo-flag `includeLanguageHeader: true` → `X-Language: ar|en`.
- Params: `include_yearly_return: boolean` (default false; true on stock landing), `include_feed: true`, `feed_detail: true`.
- Polling: if `stats.symbol_state === "S" && !is_ipo` refetch every 30 s; otherwise stale 15 min.

Evidence `chunks_2772-e89a73a54fbbb643.js:229`:
```js
return (await i.aP.get(`/assets-service/assets/${e}`, {
  headers: { includeLanguageHeader: !0 },
  params: { include_yearly_return: t, include_feed: !0, feed_detail: !0 }
})).data
```
```ts
interface AssetDetails {                 // fields observed being read [I unless noted]
  id: string;
  symbol: string;                        // chart `name`
  name: string;                          // chart `description`
  asset_class: AssetClass;               // INDEX → chart type "index"
  market?: Market;                       // chart datafeed uses r?.market ?? current market [C]
  currency?: number | "EGP" | "USD";     // mapped through Currency map
  is_3dp?: boolean;                      // price has 3 decimals (TradingView pricescale 1000 vs 100) [C]
  round_digits?: number;
  is_ipo?: boolean;
  is_tradable?: boolean;
  logo?: string;                         // URL
  industry?: string;                     // localized sector string
  ceo?: string;
  hq?: string;
  about?: string;                        // localized company description
  last_price?: number;                   // used by TradingView getQuotes `lp` [C]
  annual_return?: { value: number; return: "gain" | "loss" | string };  // when include_yearly_return=true; live 2026-10-06: COMI `{value: 30.01, return: "gain"}`. The UI shows `value` as a percent coloured by `return`
  stats?: { symbol_state?: "S" | string; [k: string]: unknown };
  feed?: AssetFeed;
  tags?: AssetTag[] | null;              // [P] live 2026-10-06; null on some payloads (e.g. constituents)
  constituents?: IndexConstituent[];     // [P] only on an index's details (asset_class INDEX)
  market_id?: MarketId | null;           // [P] top-level board too (NOPL for COMI, null for EGX30)
  is_market_indicator?: boolean;         // [P] true for indices (EGX30: market_indicator_weight 4)
  dividends?: unknown[];                 // in the payload, but the web UI never reads it (ThndrX shows no dividend history)
}
interface AssetTag {                     // [P] live 2026-10-06 (COMI)
  id: number;                            // e.g. 186 "Banks", 205 "Same Day Tradable", 183 "EGX30 Index"
  slug: string;                          // e.g. "Banks", "Same_Day_Tradable", "EGX30"
  name: string;                          // display name
  hidden: boolean;                       // thndr-mcp drops hidden tags
  market: string | null; about: string | null; rank: number; is_featured: boolean | null;
  small_sq_pic: string | null; small_rect_pic: string | null; large_rect_pic: string | null;
  background_color: string | null; created_at: string;
  assets_count: number | null; assets: unknown[];   // always null / [] here: no endpoint lists a tag's instruments
}
interface IndexConstituent {             // [P] live 2026-10-06 (EGX30); ThndrX reads only `id` (module 50766) [C]
  id: string;                            // member asset id (= asset_id)
  asset_id: string; symbol: string; name: string; asset_class: AssetClass; market: Market;
  market_id: MarketId; currency: "EGP" | string; logo: string; about: string;
  tags: null; feed: null;                // no prices: join with marketwatch by id
  index_id: string;                      // the index's numeric id as a string ("10" for EGX30)
}
interface AssetFeed {                    // `feed_detail=true` [I]
  price?: number;                        // live/last price (initial value for realtime subscription)
  previous_close?: number;
  last_trade_price?: number;
  open?: number;
  last_change_prc?: number;
  avg_value?: number;                    // shown as "average volume"
  market_id?: MarketId;                  // EGX board (NOPL, OOTC, ...) — drives market status & sessions
  day_tradable?: boolean;                // T+0 eligible
  day_trade_limit?: number;
  min_price_limit?: number;              // daily price band
  max_price_limit?: number;
}
```
Fallback price used by UI: `Number(livePrice) || feed.last_trade_price || feed.price || feed.previous_close` (`chunks_6200…js` module 82868) [C].

**Tags** [P]: instrument details carry `tags` such as the sector ("Banks"), the index ("EGX30 Index"), "sharia",
"Same Day Tradable" or "dollar_hedge". The ThndrX UI shows only three tag ids, as icons [C]: **205** (icon `t_zero`; live
this is "Same Day Tradable"), **157** (icon `islamic_star`) and **185** (icon `bank_slash`); the names of 157 and 185
were not observed live. Tags are informational only: there is no
endpoint that lists the instruments under a tag (`assets` is always empty), so thndr-mcp shows tags per instrument and
never crawls instruments to build a tag list (ADR 0018).

**Index constituents** [P]: an index's details (`asset_class: "INDEX"`, `currency: "points"`) carry `constituents`,
the member assets without prices or weights (EGX30: 30 members). Live 2026-10-06 the indices with constituents are
EGX30, EGX30 Capped, EGX70 EWI, EGX100 EWI, EGX35-LV, Shariah and Tamayuz (ThndrX's list in module 36064:
`EGX30CAPPED`, `EGX100 EWI`, `EGX70 EWI`, `EGX30`, `SHARIAH`, `EGX35-LV`, `TAMAYUZ`). thndr-mcp reads
`constituents[].id` (`IndexMembership`, cached 6 h) and joins the members with marketwatch rows.

### 1.3 Marketwatch (all instruments with live snapshot) — `GET /assets-service/assets/marketwatch` [C]
- Client `aP`. Params: `market` (Market). Polled frequently (debug-level logging).
- Response is the data source for the market table, heatmap, screeners (client-side filtering), stock stats.

Evidence `chunks_3073-1086eff233e85e69.js:1783`:
```js
return (await r.aP.get("/assets-service/assets/marketwatch", { params: { market: a } })).data
...
g.v.isEnabled("thndrx_tables_use_security_data_store") && (0, o.w)(t.assets), t
```
Row normaliser (module 15327, `chunks_3073…js:45`) lists the backend fields exactly [C]; additional fields are read by the table column defs (`chunks_3820-c6fb36c81c8f811c.js:846-1552`) [C field names, I types]:
```ts
interface MarketwatchResponse { assets: MarketwatchAsset[] }
interface MarketwatchAsset {
  asset_id: string;
  reuters: string;               // ticker symbol, e.g. "COMI"
  eng_name?: string; arb_name?: string;
  eng_desc?: string;             // sector (Sector enum values)
  asset_class?: AssetClass;
  currency?: number;             // 1 egp, 2 usd, 0 points
  round_digits?: number;
  symbol_state?: "S" | string;   // "S" = suspended
  last_trade_price: number; close_price?: number; previous_close: number; open_price?: number;
  last_change?: number; last_change_prc?: number;
  high_price: number; low_price: number;
  last_trade_volume: number; last_trade_date: string;
  bid_price: number; bid_volume: number; ask_price: number; ask_volume: number;
  listed_shares: number; pe_ratio: number; eps: number; dividend_yield_perc: number;
  total_value: number; total_volume: number; total_trades: number;
  total_bids: number; total_asks: number; total_buy: number; total_sell: number;
  avg_change: number; avg_change_prc: number;
  symbols_rec_serial: number; trade_rec_serial: number;
  ref_price: number;
  high_price_limit: number; low_price_limit: number; max_limit: number; min_limit: number; enable_price_limit: boolean;
  avg_5_day: number; avg_30_day: number; avg_90_day: number; avg_180_day: number;
  high_52_week: number; low_52_week: number;
  day_trade_limit: number; is_same_day: boolean;
}
```
Live observations 2026-10-06 [P]: `asset_class` is **absent** from marketwatch rows; `market_id` is the EGX board
(`NOPL`, `OOTC`, … and **`INDX` for index rows**). Index rows (EGX30, EGX30CAPPED, EGX35-LV, EGX70 EWI, EGX100 EWI,
SHARIAH, TAMAYUZ) are part of the snapshot: `currency` 0 (points), `eng_name`/`arb_name` null, `eng_desc` blank
(`" "`), `reuters` may contain spaces (`"EGX70 EWI"`), filler values (`last_trade_date` `1900-01-01…`,
`listed_shares`/`pe_ratio`/`bid_price`/`ask_price` 0, `low_price_limit` > `high_price_limit`) and huge
`total_value`/`total_volume` (the whole index's turnover). thndr-mcp keeps them (sanitised symbol, e.g. `EGX70-EWI`)
for index levels and membership, but never returns them from `screen_market` or `get_peers`. A row whose
`last_trade_price` is 0 has not traded yet today: `last_change` is then `-previous_close` and `last_change_prc` 0
(e.g. an OTC row).

Derived values the UI computes (useful for MCP tools): `market_cap = listed_shares * (last_trade_price || close_price)`,
`relative_volume = total_volume / avg_30_day * 100`, `high_52_week_distance`, `low_52_week_distance` (% distance from last price),
`last_change = last_trade_price - previous_close`.

### 1.4 Market indicators / rank2 / recommendations / securities v1
See section 8 (Misc market endpoints) below.

---

## 2. Price history & charts

There are **two** history endpoints.

### 2.1 Simple line chart — `GET /assets-service/charts` [C]
- Client `aP`. Used by the stock landing/overview mini-chart (`chunks_4856-b1391c64ea89d9ab.js:375-405`).
- Params (`paramsSerializer: { indexes: null }` → repeated keys `asset_ids=a&asset_ids=b`):
  - `asset_ids: string[]`
  - `option: ChartOption`
  - `market: Market`
- Intraday option (`1d-1min`) refetches every 60 s; others cached 60 s.

```js
A = { "1D": "1d", "1d-1min": "1d-1min", "1W": "1w", "1M": "1M", "6M": "6M", "1Y": "1y", "2Y": "2y", ALL: "all" };
async function D({ assetIds: e, interval: t, market: a }) {
  let l = { asset_ids: e, option: A[t], market: a },
    { data: s } = await S.aP.get("/assets-service/charts", { params: l, paramsSerializer: { indexes: null } });
  return s
}
...
let a = eM?.[eh];                                  // keyed by asset id
Object.entries(a).map(([t, a]) => ({ time: ..., price: a, timestamp: new Date(t).getTime() }))
```
```ts
type ChartOption = "1d" | "1d-1min" | "1w" | "1M" | "6M" | "1y" | "2y" | "all";   // [C]
// Response: map assetId -> map ISO-datetime -> price (number | null)               // [C] structure
type AssetChartsResponse = Record<string /*assetId*/, Record<string /*ISO timestamp*/, number | null>>;
```

### 2.2 OHLCV candles (TradingView Advanced Charts datafeed) — `GET /feed/advanced-charts/v2/{assetId}/trades` [C]
**New endpoint not in the known list.**
- Client `Kc` → full URL `https://prod.thndr.app/krakend-thndr-x/feed/advanced-charts/v2/{assetId lower-cased}/trades`.
- Krakend: errors may surface as `error_error_feed-historicals-service` key (see 0.2).
- Params:
  - `resolution`: `"1MIN" | "5MIN" | "10MIN" | "1HR" | "1D" | "1W"` (API granularity)
  - `start_timestamp`: unix **seconds** (int; client clamps to ≥ now−5y, and normalises to 10 digits)
  - `end_timestamp`: unix seconds
- 429 → retried with backoff; empty `trades_candles` five times in a row → client stops (noData).

Evidence `chunks_2987-84112a189893841f.js:4076-4093, 4134-4215`:
```js
async function T({ asset_id: e, resolution: t, start_timestamp: r, end_timestamp: i, isLastBar: o = !1 }) {
  let { data: n } = await s.Kc.get(`/feed/advanced-charts/v2/${e.toLowerCase()}/trades`, {
    params: { resolution: t, start_timestamp: r, end_timestamp: i }, skipResponseLog: !o });
  return n
}
...
let l = "1D" === t ? "1D" : "1W" === t || "1M" === t ? "1W" : "10" === t ? "10MIN" : "5" === t || "15" === t ? "5MIN" : Number(t) >= 60 ? "1HR" : "1MIN"
...
points: b.trades_candles.map(e => ({ time: Date.parse(e.timestamp), open: Number(e.open), high: Number(e.high),
          low: Number(e.low), close: Number(e.close), volume: Number(e.volume) }))
```
TradingView resolution → API resolution mapping [C]:

| TV resolution | API `resolution` | notes |
|---|---|---|
| `1`, `30` | `1MIN` | (30 falls through to 1MIN, aggregated client-side by TV) |
| `5`, `15` | `5MIN` | |
| `10` | `10MIN` | |
| `60`, `120`, `240`, `360` | `1HR` | |
| `1D` | `1D` | |
| `1W`, `1M` | `1W` | monthly bars are built client-side from weekly bars |

Supported TV resolutions: `["1","5","10","15","30","60","240","1D","1W","1M"]`; intraday multipliers `["1","5","10","60"]`.
Lookback padding: intraday requests extend `from` by 3× the window, daily+ by 0.2×, and skip back over non-session days.
Daily/weekly bars: client rewrites each bar's `open` to the previous bar's `close` (gap-less candles) — the raw API open is the first trade price.

```ts
type CandleResolution = "1MIN" | "5MIN" | "10MIN" | "1HR" | "1D" | "1W";   // [C]
interface CandlesResponse {                                              // [C] field names
  trades_candles: Array<{
    timestamp: string;      // ISO-8601 (Date.parse)
    open: string | number;  // coerced with Number() → likely decimal strings [I]
    high: string | number;
    low: string | number;
    close: string | number;
    volume: string | number;
  }>;
}
```
Live bar updates: the datafeed subscribes to the Firebase realtime price (section 6) and patches the last bar;
it also re-fetches the last bar periodically (1m: 10 s, 5m: 20 s, 10m: 30 s, 15m: 40 s, 30m: 45 s, 1h: 50 s, 4h/1D: 60 s, 1W/1M: 120 s).
Market open check uses `GET /market-service/markets/status` (see misc part) via `getMarketStatus(market, market_id).is_active`, falling back to the hard-coded session.

TradingView `getQuotes` is synthesised from asset details: `{ n: assetId, s: "ok", v: { lp: details.last_price } }` [C].

### 2.3 TradingView user storage (layouts/drawings/templates) — see misc part (`/users-service/tvcharts/*`, `/tvcharts/v1/*`).

---

## 3. Order book & trades

### 3.1 Market depth — `GET /assets-service/market-depth/{assetId}` [C]
- Client `aP`. No params. Polled every **2 s** (`refetchInterval: 2e3`, stale 5 s).

Evidence `chunks_app_mobile_stock_page-6d5a74f0bb63edf0.js:2457-2478`, consumers `lazy_1083.0eef8a6ec8374790.js:66-182`, `lazy_3916.f922982afee71bb2.js:268-819`.
```ts
interface MarketDepthResponse {                       // [C] field names, [I] types
  bids_per_price: DepthLevel[];                       // best first
  asks_per_price: DepthLevel[];                       // best first (UI renders reversed)
  total_bids_and_asks?: { total_bids: number; total_asks: number };
}
interface DepthLevel {
  order_price: number;
  volume_traded: number;   // aggregated quantity at the level
  split?: number;          // number of orders at the level ("Split" column)
}
```
Display variants: `horizontal | vertical | bid-only | ask-only` (UI only).

### 3.2 Trades book (time & sales) — `GET /assets-service/market-depth/{version}/trades-book/{assetId}` [C]
- Client `aP`. `{version}` = `"v3"` when unleash flag `thndrx_use_trades_book_v3` is on, else `"v2"`.
- Params: `page_size` (default 50), plus cursor: `before=<cursor>` (older page, infinite scroll) **or** `after=<cursor>` (newer trades; polled every 5 s with the newest cursor).
- Pagination: next page cursor = `trades[trades.length-1].cursor`; newest cursor = `trades[0].cursor`.

Evidence `chunks_app_mobile_stock_page-6d5a74f0bb63edf0.js:2496-2516`:
```js
let r = { page_size: t };
if (!i && !a) return null;
a && (r["before" === l ? "before" : "after"] = a);
let { data: n } = await d.aP.get(`/assets-service/market-depth/${s}/trades-book/${e}`, { params: r });
```
```ts
interface TradesBookResponse { trades: Trade[] }           // [C]
interface Trade {                                          // [C] names from lazy_3916…js:131-150
  cursor: number | string;   // `.toString()` is called → numeric in practice [I]
  price: number;
  volume: number;
  side: "BUY" | "SELL";      // v2: BUY→bid, else ask; v3 passes side through
  time: string;              // ISO timestamp [I]
}
```

---

## 4. Watchlists

### 4.1 Custom watchlists — `/users-service/watchlists` (client `aP`) [C]

| Op | Method & path | Params / body | Evidence |
|---|---|---|---|
| List | `GET /users-service/watchlists` | `?market=<Market>` | `chunks_4652…js:476` |
| Get one | `GET /users-service/watchlists/{id}` | — → `{ asset_ids: string[] }` | `chunks_4652…js:412` |
| Create | `POST /users-service/watchlists` | `{ name, market, source, asset_ids: string[] }` | `chunks_2409…js:963` |
| Rename | `PATCH /users-service/watchlists/{id}` | `{ name }` | `chunks_2409…js:548`, `lazy_9164…js` (RenameWatchlistModal) |
| Delete | `DELETE /users-service/watchlists/{id}` | — | `chunks_2409…js:899` |
| Add assets | `POST /users-service/watchlists/{id}/watch-assets` | `{ asset_ids: string[] }` | `chunks_668…js:80`, `lazy_2514…js:480` |
| Remove assets | `POST /users-service/watchlists/{id}/unwatch-assets` | `{ asset_ids: string[] }` | `chunks_668…js:791` |

```js
// chunks_2409-eb4a9a9ec1795a29.js:957
async function d({ name: e, market: t, source: a, assetIds: s = [] }) {
  return (await n.aP.post("/users-service/watchlists", { name: e, market: t, source: a, asset_ids: s })).data
}
// chunks_668-1a0a12704d0a0b68.js:80
let s = `/users-service/watchlists/${e}/${a}-assets`;   // a ∈ "watch" | "unwatch"
return n.aP.post(s, { asset_ids: [t] })
```
```ts
interface WatchlistsResponse { watchlists: Watchlist[] }      // [C] key
interface Watchlist {                                         // [C] from optimistic insert in chunks_2409…js:935
  id: string;
  name: string;
  color: string;      // e.g. "color_4"
  icon: string;       // e.g. "thndr"
  count: number;      // == asset_ids.length
  asset_ids: string[];// ordered
}
interface WatchlistDetail { asset_ids: string[] }             // [C]
interface CreateWatchlistBody { name: string; market: Market; source: "thndrx" | string; asset_ids?: string[] }
// create response: contains at least { id } (used as e.id) [C]
```
`source` values seen: `"thndrx"` (chunks_2409…js:2447, lazy_3946…js:60), `"listing_widget"` (analytics source, lazy_3946…js:1563) [C].
Watch/unwatch responses are ignored by the UI.

### 4.2 Default ("Favorites") watchlist — `/assets-service/watchlist` (client `aP`) [C]

| Op | Method & path | Params / body |
|---|---|---|
| Get | `GET /assets-service/watchlist` | `?include_feed=false&market=<Market>` → array |
| Add | `PATCH /assets-service/watchlist` | `{ asset_id }` (one request per asset) |
| Remove | `DELETE /assets-service/watchlist` | body `{ asset_id }` (axios `data`) |

Evidence `chunks_668-1a0a12704d0a0b68.js:372, 663, 2482`.
```ts
type DefaultWatchlistResponse = Array<{ id: string /* asset id */; symbol?: string; feed?: AssetFeed; [k: string]: unknown }>;  // [I] UI inserts {id, symbol}
```

---

## 5. Screeners & price alerts

### 5.1 Screeners — `/users-service/screeners` (client `aP`) [C]

| Op | Method & path | Params / body | Evidence |
|---|---|---|---|
| List | `GET /users-service/screeners` | `?market=` → `{ screeners: Screener[] }` | `lazy_9243…js:290` |
| Get | `GET /users-service/screeners/{id}` | → `Screener` | `lazy_9243…js:365` |
| Create | `POST /users-service/screeners` | `{ source: "thndrx", market, filters: ScreenerFilter[], name }` | `lazy_3165…js:72` |
| Rename | `PATCH /users-service/screeners/{id}` | `{ name }` | `lazy_5405…js:254` |
| Replace filters | `PUT /users-service/screeners/{id}/filters` | `{ filters: ScreenerFilter[] }` | `lazy_5405…js:256` |
| Delete | `DELETE /users-service/screeners/{id}` | — | `lazy_1143…js:197` |

**Screeners are evaluated client-side** on the marketwatch rows (`chunks_2409…js` module 86697): the backend only stores definitions.
```ts
interface ScreenersResponse { screeners: Screener[] }                // [C]
interface Screener { id: string; name: string; filters: ScreenerFilter[]; market?: Market; source?: string }  // [C] id/name/filters
type ScreenerFilterType = "NumberRange" | "DateRange" | "StringArray" | "StringLoose" | "String" | "Number";   // [C]
interface ScreenerFilter {
  filter_key: string;          // a MarketwatchAsset field or derived key (below)
  type: ScreenerFilterType;
  min_value?: string;          // NumberRange/DateRange, decimal string, omitted if empty
  max_value?: string;
  value?: string;              // StringArray: JSON-encoded array string e.g. '["Banks","Real Estate"]'
  id?: string;                 // present in built-in presets
}
```
Live 2026-10-06 [P]: `GET /users-service/screeners?market=egypt` returned `{"screeners": []}` for an account without
saved screeners (the shape of a stored screener was not observed live; the fields above come from the bundle).

**Evaluator** (module 86697 in `chunks_2409…js`, identical copies in `chunks_6227`, `chunks_7810`) [C]. It keeps the
marketwatch rows whose `reuters` is **not** one of the index symbols of module 36064 (`EGX30CAPPED`, `EGX100 EWI`,
`EGX70 EWI`, `EGX30`, `SHARIAH`, `EGX35-LV`, `TAMAYUZ`) and that pass **every** filter. Per filter, the value is:

| `filter_key` | Value (module 29210 `kP`/`U7`/`Jm`, module 62601 `jW`, in `chunks_3073…js`) |
| --- | --- |
| `price` | `last_trade_price !== 0 ? last_trade_price : close_price ?? 0` |
| `last_change` | `(last_trade_price ?? 0) − (previous_close ?? 0)` |
| `last_change_prc` | `(last_trade_price − previous_close) / previous_close × 100` (so −100 before the first trade of the day) |
| `relative_volume` | `Jm(total_volume ?? 0, avg_30_day ?? 0)`: `null` when either is 0 (**the row fails the filter**), else `Number((v / a × 100).toFixed(0))` (an integer) |
| `high_52_week_distance` | `jW(high_52_week ?? 0, last_trade_price ?? 0)`: 0 when either is 0, else `parseInt(abs((last − ref) / ref × 100).toFixed(0))` |
| `low_52_week_distance` | same with `low_52_week` |
| anything else | `row[filter_key]` (e.g. `total_value`, `dividend_yield_perc`, `eng_desc`, `pe_ratio`, `eps`, `avg_5_day`…) |

Then by `type`:

- `NumberRange`: `Number(value)` within `[min, max]`, **both inclusive**; a falsy bound (missing, `""`) is open, the
  string `"0"` is a bound. `Number(null)` is 0, so a null field passes a range that includes 0 (e.g. P/E ≤ 10).
- `StringArray`: `JSON.parse(filter.value || "[]").includes(fieldValue)` (exact, case-sensitive). A parse error makes the filter
  pass silently.
- `StringLoose`: case-insensitive substring. `String`: exact string equality. `Number`: `Number(a) === Number(value)`.
- Any other type (e.g. `DateRange`): the filter passes.

The filter editor (`chunks_6227…js`) offers the keys `reuters`, `price`, `total_value`, `total_volume`,
`total_trades`, `last_trade_volume`, `avg_volume` (written as `avg_5_day`/`avg_30_day`/`avg_90_day`),
`relative_volume`, `high_52_week_distance`, `low_52_week_distance`, `listed_shares`, `last_change_prc`, `pe_ratio`,
`dividend_yield_perc`, `eps`, `eng_desc` [C].

**thndr-mcp** evaluates presets and saved screeners with these exact rules on its quotes (`matchesScreener` in
`src/domain/market-data/screener.ts`; key mapping in `repositories/thndr/translators/screener.ts`). Two deliberate
differences: index rows are excluded by board (`market_id === "INDX"`), and filters it cannot evaluate (an unmapped
key such as `ref_price`, a `DateRange`, an unparsable `StringArray`) make `screen_market` fail with a message naming
them instead of passing silently.

**Built-in "recommended screeners"** (client-only presets, module 22462 in `chunks_2409…js:47-180`; English names from
the `screeners.recommendedScreeners.*` strings) [C]. All filters are `NumberRange` unless stated:

| id | Name | Filters |
| --- | --- | --- |
| `momentum-movers` | Momentum Movers | `total_value` ≥ 1,000,000; `relative_volume` ≥ 100; `high_52_week_distance` ≤ 10; `last_change_prc` ≥ 2 |
| `breakout-radar` | Breakout Radar | `total_value` ≥ 2,000,000; `relative_volume` ≥ 100; `high_52_week_distance` ≤ 5; `last_change_prc` ≥ 0 |
| `value-yield` | Value & Yield | `high_52_week_distance` ≤ 20; `dividend_yield_perc` ≥ 4; `eng_desc` (`StringArray`) in "Non-bank financial services", "Real Estate", "Textile & Durables", "Basic Resources" |
| `steady-performers` | Steady Performers | `relative_volume` ≥ 70; `high_52_week_distance` ≤ 15; `last_change_prc` ≥ 0; `dividend_yield_perc` ≥ 2 |
| `reversal-watch` | Reversal Watch | `relative_volume` ≥ 100; `low_52_week_distance` ≤ 5; `last_change_prc` ≥ −2 |

The screeners page selects a preset or a saved screener with `?screenerId=<id>` (presets first) [C]; presets are
not market-specific in code.

### 5.2 Price alerts — `/price-alerts/v1/*` (client `Kc` = krakend) [C]

| Op | Method & URL | Params / body | Evidence |
|---|---|---|---|
| List (all) | `GET {krakend}/price-alerts/v1/alerts` | `?page=1&page_count=10&market=<Market>` (infinite; next page while `results.length === page_count`) | `chunks_2987…js:3563-3600` |
| List for asset | `GET {krakend}/price-alerts/v1/asset-alerts/{assetId}` | `?page=1&page_count=5` | `chunks_6200…js:637` |
| Create | `POST {krakend}/price-alerts/v1/alerts` | `{ asset_id, price, frequency, direction, market }` | `chunks_6200…js:22`, payload `:1290` |
| Delete | `DELETE {krakend}/price-alerts/v1/alerts/{alertId}` | — (404 swallowed) | `chunks_6200…js:150` |
| Edit | *(no PUT)* — UI does DELETE then POST | | `chunks_6200…js:925` |

`{krakend}` = `https://prod.thndr.app/krakend-thndr-x`. Krakend error key: `error_price_alerts`.

```js
// chunks_6200-d79bd4bfd5d93136.js:1290
D({ asset_id: w, price: e, frequency: B ?? f.T7.ONE_TIME,
    direction: (0, P.i)({ referencePrice: C, targetPrice: e }) })   // + market added by the mutation
// direction = targetPrice < currentPrice ? "DOWN" : "UP"
```
```ts
enum AlertFrequency { ONE_TIME = "ONE_TIME", RECURRING = "RECURRING" }    // [C] module 88400
enum AlertDirection { UP = "UP", DOWN = "DOWN" }                          // [C]
interface CreatePriceAlertBody { asset_id: string; price: number; frequency: AlertFrequency; direction: AlertDirection; market: Market }
interface PriceAlertsPage { results: PriceAlert[]; [k: string]: unknown }  // [C] `results`
interface PriceAlert {                    // [C] names from lazy_7241…js:873-888
  id: string | number;                    // String(id) used for row id
  asset_id: string;
  asset_symbol: string;
  price: number;                          // trigger value
  frequency: AlertFrequency;
  direction?: AlertDirection;             // [I]
  created_at: string;                     // ISO [I]
}
```
Notification type `price_alert_triggered` invalidates the `price-alerts` queries (see notifications in misc part).

---

## 6. Realtime prices — Firebase Realtime Database [C]

No websockets/SSE of their own: the only realtime channel is the **Firebase RTDB SDK** (which itself uses a websocket to
`wss://thndrx-realtime-db.europe-west1.firebasedatabase.app/.ws`). Everything else is HTTP polling.

Firebase config (module 38938, `chunks_3515…js:676`):
```js
{ apiKey: "AIzaSyCUbo98qRd0KJZbFLfNH0n4_v476vp7XFY", authDomain: "thndr-api.firebaseapp.com",
  databaseURL: "https://thndrx-realtime-db.europe-west1.firebasedatabase.app", projectId: "thndr-api",
  messagingSenderId: "639172574829", appId: "1:639172574829:web:fffdf73e598f98d872c964" }
```
Auth: RTDB rules require a signed-in Firebase Auth user of project `thndr-api` (the same user whose ID token is the
"firebase token"; obtained via `signInWithCustomToken` after login — e.g. `POST /api/auth/exchange-token` returns `custom_token`).
Unauthenticated REST read → `401 {"error":"Permission denied"}` [P]. For a Node MCP server either use the `firebase` JS SDK
(`signInWithCustomToken` / persisted refresh token) or REST: `GET https://thndrx-realtime-db.europe-west1.firebasedatabase.app/<path>.json?auth=<firebaseIdToken>`
(and `Accept: text/event-stream` for REST streaming — standard Firebase behaviour, not used by the app).

Paths (module 80529, `chunks_3073-1086eff233e85e69.js:1579-1705`):
```js
let c = "thndrx_enable_asset_price_feed",
  p = { price: "price", previous_close: "previous_close" },
  l = { price: "price/last/value", previous_close: "day_snapshot/last/previous_close" };
function m(a, t, e) { return e ? `assetPrice/${a}/${l[t]}` : `marketFeed/${a}/${p[t]}` }
// subscribe: onValue(ref(getDatabase(), path), snap => snap.val())
```

| unleash `thndrx_enable_asset_price_feed` | live price path | previous close path |
|---|---|---|
| ON (new) | `assetPrice/{assetId}/price/last/value` | `assetPrice/{assetId}/day_snapshot/last/previous_close` |
| OFF (legacy) | `marketFeed/{assetId}/price` | `marketFeed/{assetId}/previous_close` |

Values are scalars (number). The app subscribes per asset (watchlist rows, positions, chart last bar, order ticket) and
batches UI updates via requestAnimationFrame. `.info/connected` is watched to show a "connecting…" toast after 5 s offline.
Snapshot objects under `assetPrice/{id}/price/last` and `assetPrice/{id}/day_snapshot/last` likely contain more fields
(only `value` / `previous_close` are read) [I].

Polling cadences (for parity): market depth 2 s; trades-book updates 5 s; intraday line chart 60 s; asset details 30 s if suspended.

---

## 7. Feature flags affecting this area (unleash) [C]
- `thndrx_enable_asset_price_feed` — RTDB path scheme (section 6). **ON** in prod per anonymous unleash probe [P] → use `assetPrice/...` paths
- `thndrx_use_trades_book_v3` — trades-book `v3` vs `v2`. **ON** in prod [P] → use `v3`
- `thndrx_tables_use_security_data_store` — marketwatch rows pushed into an in-memory store (UI only); OFF [P]
- `thndrx_enable_saving_tv_templates` — TradingView templates persistence
- `thndrx_web_rumble_account_linking` — advisory gate on rumble client (out of scope)
(Unleash proxy configuration documented in misc part.)

---

## 8. Misc market endpoints: indicators, recommendations, securities, notifications, tags, market status, news, flags, tvcharts

Paths are relative to `pretty/`. Status labels:
- **[C]** confirmed: the call site or the field use was read directly in the bundle.
- **[I]** inferred: guessed from how the UI uses the data, or from names.

Clients come from module 2938 in `chunks_3515`:

| Export | Base URL | Auth |
|---|---|---|
| `aP` | `https://prod.thndr.app` | `Authorization: Bearer <full_access>`. If the request carries header flag `authorizationAuth: true`, it becomes `Authorization: Auth <full_access>`. Header flag `includeLanguageHeader: true` becomes `X-Language: ar\|en` (the default is `ar`). |
| `Kc` | `https://prod.thndr.app/krakend-thndr-x` | Bearer full_access. The response interceptor is `p4` (see below). |
| `kQ` | `https://prod.thndr.app` | Bearer limited_access token, from `POST /auth-service/v2/tokens/limited-access`. |
| `zC` | `/api`, which is `https://x.thndr.app/api` | Bearer full_access. |

All clients also send these headers:
- `X-Correlation-ID: <uuid>`
- `x-thndrx-runtime-version: <major.minor.patch>`

Unauthenticated error shape [C] (probed): HTTP 401 with `{"detail":{"msg":"Missing token","type":"MISSING_TOKEN"}}`.

#### Krakend error envelope: interceptor `p4`, used only by `Kc` [C]

Evidence: `chunks_3515-3f5b9465a524d3e5.js:862-889`.

Krakend combines several backends into one response. When one backend fails, the response is still HTTP 200, but the body contains one of these keys:

`error_error_feed-historicals-service, error_price_alerts, error_asset_day_snapshot, error_asset_price, error_asset_metadata, error_full_trades, error_partial_sells, error_trading_metrics, error_security_position, error_get_clouds, error_transfer_types_clouds, error_calculate_transfer_fees, error_external_transfer, error_update_cloud_transfer_request, error_transactions_clouds, error_clouds_stats, error_get_notifications, error_patch_notifications_batch, error_get_notifications_has_unread, error_patch_notifications_read_all`

The value has this shape:

```ts
interface KrakendBackendError { http_status_code?: number; http_body?: string /* JSON: {"detail":{"msg":string,"type":string}} */ }
```

When `p4` finds one of these keys, it throws an AxiosError whose message is `detail.msg`, whose code is `detail.type`, and whose `status` is `http_status_code`.

There is no unwrapping of envelopes and no case conversion. Responses are snake_case as the server sends them. `r4` (used by `aP`/`kQ`) only logs.

**MCP guidance:** for every `Kc` call, check whether any `error_*` key is present and treat it as an error.

---

### 1. `GET /assets-service/assets/rank2`: warm-up ping, not a data endpoint [C]

Evidence: `chunks_main-app-accef77520b86eec.js:117-133`.

```js
let n = "/assets-service/assets/rank2", o = ["https://prod-eks.thndr.app","https://prod.thndr.app"];
async function a(e){ try{ let t = await fetch(`${e}${n}`,{method:"GET",cache:"no-store"}); await t.text() }catch{} }
// s(): window.setTimeout(... for each origin in random order ... await a(e), 1e4)
```

- It is a plain `fetch` with no auth. The app calls it 10 s after load against both `prod-eks.thndr.app` and `prod.thndr.app`, and ignores the response. It looks like a connection or WAF warm-up.
- The response shape is unknown. The web app never parses it. The name suggests an asset ranking such as top movers [I].
- It is not worth exposing in the MCP unless it is probed with a token.

### 2. `GET /assets-service/assets/market-indicators` (client `aP`) [C]

Evidence: `chunks_2801-df46d7c8cf4859f7.js:2570-2603` (the same code is in `chunks_2409:983`).

```js
await i.aP.get("/assets-service/assets/market-indicators", { params: {
  page_count: 100, feed_detail: true, include_feed: true, include_usd_rate: true, market: "egypt" }})
// select: e?.results?.filter(e => e?.id !== "b0a4c53e-b12f-4e93-b94b-759b8eeaef14")   // one indicator hidden client-side
// staleTime = refetchInterval = 5 min
```

**Query parameters:**

| Param | Type | Value used by the web app |
|---|---|---|
| `market` | `"egypt"` | always `egypt` |
| `page_count` | number | 100 |
| `include_feed` | bool | true |
| `feed_detail` | bool | true |
| `include_usd_rate` | bool | true |

There is probably also a `page` parameter [I].

**Response:**

```ts
interface MarketIndicatorsResponse { results: MarketIndicator[]; /* count/next? [I] */ }
interface MarketIndicator {
  id: string;            // asset uuid [C]
  symbol: string;        // [C] e.g. "EGX30","EGX30CAPPED","EGX35-LV","EGX70 EWI","EGX100 EWI","SHARIAH","EGGOLD","USD/EGP","DIA","SPY","QQQ","FADGI","GLD","SLV","USO"
  feed?: { price?: number; last_trade_price?: number; last_change_prc?: number; previous_close?: number; market_id?: string }; // [C] price used; others [I] from the shared feed shape
  // name/asset_class etc. likely as in the generic Asset shape [I]
}
```

Known symbols come from `lazy_2102.aaef863752b0c767.js:68-84`, which maps each symbol to an i18n key.

UI behaviour [C] (`lazy_2102:461-465`):
- The live value is `marketFeed`/RTDB price if present. Otherwise it is `feed.last_trade_price` when that is > 0, else `feed.price`.
- The change shown is `feed.last_change_prc`.
- The unit is "pts" for indices.
- The status (open, delayed or closed) comes from market status `is_active`.

### 3. `GET /assets-service/assets/{assetId}/recommendations` (client `aP`, sends `X-Language`) [C]

Evidence: `chunks_4856-b1391c64ea89d9ab.js:1219-1236`.

```js
await y.aP.get(`/assets-service/assets/${t}/recommendations`, { headers:{includeLanguageHeader:true},
  params:{ market: e /* default "egypt" */, recommendations_number: a /* default 4 */, include_feed: l /* default false */, feed_detail: s /* default false */ }})
```

The "similar stocks" widget calls it with `include_feed=true` and `feed_detail=true`.

**Response** [C for `results`, `id`, `symbol`, `name`, `is_ipo`; P for the rest, live 2026-10-06 for COMI with
`recommendations_number=4`]:

```ts
interface RecommendationsResponse { count: number; results: RecommendedAsset[] }   // count 4 = recommendations_number
// Each result is a full asset-details payload (§1.2), e.g. ADIB and CANA for COMI (same industry "Banks"):
interface RecommendedAsset {
  id: string; symbol: string; name: string; reuters: string /* "ADIB.CA" */; isin: string;
  asset_class: AssetClass; market: Market; market_id: MarketId; industry: string; currency: "EGP" | string;
  is_tradable: boolean; is_ipo: boolean; logo: string; about: string; tags: AssetTag[] | null;
  stats: { market_cap: number; avg_value: number; div_yield_prc: number; pe: number; eps: number; symbol_state: string };
  feed?: AssetFeed & { market_cap: number; pe: number; div_yield_prc: number; value: number; /* … */ };
}
```

thndr-mcp (`get_peers`) maps the results as instruments (id, symbol, name, industry) and takes prices from
marketwatch instead of `feed`.

### 4. Securities batch APIs on krakend (client `Kc`)

Evidence: `lazy_8716.60fcf1be58dabd32.js:31-123`.

The app batches these requests through a request manager:
- 300 ms debounce.
- At most 50 IDs per request.
- IDs are sorted with `localeCompare`.
- IDs are sent as repeated `asset_id` query parameters.

#### 4a. `GET /securities/v1/metadata?asset_id=A&asset_id=B…` [C]

Headers:
- `X-Language` (through `includeLanguageHeader`).
- `Cache-Control: no-store` by default (`disableGWCache=true`), which bypasses the gateway cache.

```ts
interface SecuritiesMetadataResponse { results: SecurityMetadata[] }   // [C] results[].id
interface SecurityMetadata { id: string; /* + metadata fields (symbol, name, logo, asset_class, currency, round_digits, market_id …) [I] */ }
```

- The client renames `id` to `asset_id` and builds a map keyed by asset id. Missing IDs become `null`.
- An empty `results` array is treated as the error `METADATA_FETCH_FAILED`.
- A partial backend failure shows up as the `error_asset_metadata` key.

#### 4b. `GET /securities/v1/price?asset_id=…&is_delayed=false` [C]

- `is_delayed` is always sent. The default is `"false"`.
- `Cache-Control: no-store` is sent by default.

```ts
interface SecuritiesPriceResponse {
  price:        { results: AssetPriceRow[] };        // [C]
  day_snapshot: { results: AssetDaySnapshotRow[] };  // [C]
}
interface AssetPriceRow       { asset_id: string; price: number; /* timestamp? [I] */ }          // price [C]
interface AssetDaySnapshotRow { asset_id: string; previous_close: number; /* open/high/low/volume? [I] */ } // previous_close [C]
```

- The client joins the two lists on `asset_id` into `{...price, ...day_snapshot}`. If either side is missing for an asset, the result for that asset is `null`.
- UI use [C] (`lazy_8716:892-895`): `prices[assetId].data.price`, `.previous_close`.
- Partial failures appear as `error_asset_price` or `error_asset_day_snapshot`.
- The paths match the RTDB layout `assetPrice/{id}/price/last/value` and `assetPrice/{id}/day_snapshot/last/previous_close`.

#### 4c. "stats" source

There is a third batch source, but it is not an HTTP endpoint of its own. It reuses `/assets-service/assets/marketwatch?market=` and picks out the requested asset IDs.

### 5. Notifications (client `Kc`)

Evidence: `lazy_8560.8cb456d68f3e1793.js:84-126,198-212` and `chunks_2801-df46d7c8cf4859f7.js:1017-1036,2444-2470,2548`.

| Method | Path | Params / body | Response |
|---|---|---|---|
| GET | `/notifications/v1` | `page` (1-based), `page_count=20` | **bare array** `Notification[]` [C]. The next page exists when `length === page_count`. |
| GET | `/notifications/v1/has-unread` | – | `{ has_unread: boolean }` [C] |
| PATCH | `/notifications/v1/read-all` | no body | ignored [C] |
| PATCH | `/notifications/v1/batch?field=is_read` | body `[{ id: string }, …]` | ignored [C]. Marks the listed notifications as read. |

```ts
interface Notification {
  id: string;          // [C]
  title: string;       // [C] (may contain emoji; UI strips them)
  text: string;        // [C] body
  is_read: boolean;    // [C]
  created_at: string;  // [C] ISO datetime, shown as "MMM D, h:mm a"
  type?: string; action?: string; // [I]
}
```

#### How notifications arrive [C]

They come as web push through **Braze**, not through websocket or Firebase. Evidence: `lazy_8560:11-64`.
- Braze is set up with `init("d264e019-6696-4ce4-bf21-d62e291fe3fb", {baseUrl:"sdk.fra-02.braze.eu"})`.
- The service worker posts to the `BroadcastChannel("push-messaging")` channel `{type:"push_received", payload:{action}}`.
- The app then invalidates the `["notifications"]` and `["notifications-has-unread"]` query keys.
- It also invalidates the keys for that action:

```js
order_cancelled|order_rejected|order_completed|order_suspended|order_activated|order_pending_submit
   -> ["orders","waived-orders-counter","balance","max-cash-and-units","security-position","security-position-blocked"]
price_alert_triggered -> ["price-alerts"]
```

Known push `action` values (the enum) [C]: `order_cancelled`, `order_rejected`, `order_completed`, `order_suspended`, `order_activated`, `order_pending_submit`, `price_alert_triggered`.

**MCP guidance:** there is no pull-based realtime channel for notifications. Poll `has-unread` and the list instead.

### 6. `GET /users-service/tags` (client `kQ`, limited-access token) [C]

Evidence: `chunks_app_layout-0d9f30cdff383c15.js:316-318`.

```js
let e = await J.kQ.get("/users-service/tags"); return e.data?.tags?.map(e => e.name) ?? []
```

```ts
interface UserTagsResponse { tags: { name: string; /* id? [I] */ }[] }
```

- Purpose: these are user segment tags. They are cached in localStorage under `userTags` for 1 h.
- They are pushed into the Unleash context as `properties.tags`, which drives flag targeting. They are not instrument tags.
- This is unrelated to `/thndrx/coverage/tags`.

### 7. Market status and hours (client `aP`)

#### 7a. `GET /market-service/markets/status?market=<market>&market_exchange=<feed.market_id>` [C]

Evidence: `chunks_3073-1086eff233e85e69.js:917-929`.

- The app refetches every 60 s.
- `market_exchange` is the asset's `feed.market_id`, for example `NOPL`, `OOTC`, `SME`, `INDX`, `FNDS` or `adsm` (enum 18291 `L`).

```ts
interface MarketStatus { is_active: boolean; /* + status/phase fields [I] */ }   // is_active [C]
```

It is used by the charts to decide whether to append a live point or bar (`chunks_4856:466`, `chunks_2987:4386-4393`).

#### 7b. `GET /market-service/markets/hours?market=<market>` [C]

Evidence: `chunks_2801-df46d7c8cf4859f7.js:2404-2430` and `chunks_app_mobile_stock_page:277`. The app treats it as stale after 1 min.

```ts
interface MarketHours { session_open: string /* ISO datetime */; session_close: string /* ISO datetime */ } // [C] (chunks_4856:408-414)
```

#### Hard-coded TradingView session config [C]

Evidence: `chunks_2987:3509-3540`. This is useful for MCP-side "is market open" logic.

| Market | Exchange | Timezone | Session | Holidays |
|---|---|---|---|---|
| egypt / NOPL / default | `EGX` | `Africa/Cairo` | `1;1000-1430:12345` (Sun–Thu 10:00–14:30) | `20260412,20260413` |
| OOTC | `EGX-OTC` | – | `2;1200-1230:24` (Mon and Wed 12:00–12:30) | – |
| simulator | `SIM` | – | same as egypt | – |

In the session string the day digits run 1 = Sun through 7 = Sat.

Market enum (51487) [C]: `simulator`, `egypt`, `us`, `adsm` (UAE), `abudhabi` (ADX).

### 8. x.thndr.app `/api/*`

- `/api/v2/profiling/quota` and `` `/api/v2/${t}` `` are **Datadog SDK intake paths**, not the app's own API. Evidence: `lazy_datadogProfiler:152`, `chunks_9796:2813`, `lazy_6092:113`. Ignore them.
- Auth routes: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/exchange-token`, `/auth/rumble-exchange`, `/ping`. These are outside this scope.
- Data routes (client `zC`, `Authorization: Bearer <full_access>` like `aP`), used by `get_financials` and
  `get_economic_indicators` (ADR 0018). **Live-verified 2026-10-06** with a free account (read-only GETs).

#### 8a. `GET x.thndr.app/api/financials`: company financials [C] [live-verified 2026-10-06]

Evidence: module 3386 in `chunks_334-680969dd75b5d939.js` (fetchers); modules 460, 13280 and 36255 and the metric
builders in the same chunk (catalogue, period parsing, valuation); `chunks_6076.95ae1c1d736db693.js` (sector
comparison).

| Param | Values |
| --- | --- |
| `symbol` | one ticker (the marketwatch `reuters`, e.g. `COMI`), or |
| `symbols` | comma-separated tickers (`COMI,ADIB`, sent as `COMI%2CADIB`) for a batch |
| `mode` | `qoq` (single quarters; the UI default), `yoy` (fiscal years), `ttm` (trailing twelve months). The UI selector offers only `qoq`/`yoy`; `ttm` is served too. |
| `dataPointCount` | optional: only the most recent N periods (observed: `dataPointCount=2` returns the last two periods of every metric) |

Response (single symbol): `{ currency: "EGP", <metric>: [{ period, value }] … }`. Every metric key maps to an array,
oldest first. `value` may be `null` (the period is listed without data) and may be fractional
(`1057167926999.9999`). Periods are `"Q2 26"` (`qoq`), `"TTM Q2 26"` (`ttm`) or `"2025"` (`yoy`). Series lengths
differ (ratios and growth rates start later). Only the keys that apply to the company are present: banks get `loans`,
`customer_deposits`, `net_loans_by_customer_deposits_%`, `net_interest_income`, `total_non_interest_income` and
`credit_loss_provisions`, and no gross-profit or cash-flow keys. `nos` (number of shares) is also returned. The
valuation keys of the UI catalogue (`market_cap`, `pe_ratio`, `ev`, …) were absent for COMI, because ThndrX computes
valuation in the browser (see below). Observed: COMI `yoy` ended at `2023` while `qoq` and `ttm` reached `Q2 26`.

Batch (`symbols=`): `{ "COMI": <single response>, "ADIB": <single response> }`. Unknown symbol (single): **HTTP 404**
with the message `Symbol not found` (our adapter turns it into `NOT_FOUND`). How a batch answers when one symbol is
unknown is not verified. The UI fetchers catch every error and return `{}`.

Metric catalogue read by the UI (module 460 and the builders):

- Balance sheet: `total_assets`, `total_liabilities`, `total_equity`, `minority_interest_bs`, `total_debt`,
  `total_cash_and_cash_equivalents`, `st_investments`, `lt_investments`, `inventory`; banks `customer_deposits`, `loans`.
- Income statement: `net_income`, `revenues`, `gross_profit`, `operating_profit`, `ebitda`, `ebit`, `eps`; banks
  `net_interest_income`, `credit_loss_provisions`, `total_non_interest_income`.
- Cash flow: `cfo`, `fcff`, `fcfe`, `capex`.
- Profitability: `roe_%`, `roa_%`, `roae_%`, `roaa_%`, `roic_%`, `gross_margin_%`, `operating_margin_%`,
  `net_margin_%`, `ebitda_margin_%`.
- Leverage: `net_debt_total_capital`, `net_debt_total_equity`, `net_debt_ebitda`, `interest_coverage_ratio`.
- Efficiency: `assets_turnover`, `inventory_turnover`, `receivables_turnover`.
- Liquidity: `current_ratio`, `quick_ratio`, `cash_ratio`.
- Growth: `revenue_growth_1y`, `eps_growth_%`, `avg_revenue_growth_3y`, `avg_eps_growth_3y`, `assets_growth_1y`,
  `equity_growth_1y`, `net_income_growth_1y`, `ebitda_growth_1y`, `revenue_cagr`, `net_income_cagr`, `ebitda_cagr`.
- Valuation: `market_cap`, `pe_ratio`, `pb_ratio`, `ps_ratio`, `peg_ratio`, `ev`, `ev_ebitda`, `ev_ebit`,
  `ev_revenues`, `dividend_yield`, `par_value`, `book_value`, `bvps`.

Percent keys (`_%` and growth rates) are already in percent.

**Sector comparison (the "metrics details" panel) [C]**, chunk 6076:

1. Peers are the marketwatch rows with `eng_desc === <the company's eng_desc>` and `listed_shares > 0` (the company
   included), sorted by `listed_shares × last_trade_price` descending. ThndrX sends one batch request
   `symbols=<all their reuters>&mode=<mode>`, with no size limit and no `dataPointCount`.
2. For each company, each metric is the **last element** of its series (`series.at(-1).value`). Valuation is computed
   against the latest period (period labels sorted by year, quarter, then TTM) at a price that depends on who is
   valued:
   - **the company itself** (module 36255 `valuateForPeriod`, fed by the `w()` hook, query key
     `valuation-price-bars`): the close of the last daily candle whose time is ≤ the end of the latest period. The
     hook loads `GET /feed/advanced-charts/v2/{id}/trades?resolution=1D` from now − 365 × 3 days (`qoq`/`ttm`) or
     now − 365 × 8 days (`yoy`) to now. The period end comes from module 13280 `cD`: a quarter ends at
     `Date.UTC(year, 3 × quarter, 0, 23:59:59.999)` (31 Mar, 30 Jun, 30 Sep, 31 Dec; TTM periods with their
     quarter), a year at 31 Dec 23:59:59.999 UTC. Without a period end, or while the candles are loading or empty,
     it uses the marketwatch price; when candles exist but none is at or before the period end, the price is
     `undefined` and the multiples stay empty;
   - **the sector peers** (the company's own sample entry included): the current marketwatch price (the builders are
     called without candles).
   - market cap = `listed_shares × price`;
   - EV = market cap + `total_debt` − `total_cash_and_cash_equivalents` − `st_investments`;
   - P/E = price / `eps` (dropped when negative);
   - P/B = market cap / (`total_equity` − `minority_interest_bs`), else price / `bvps`;
   - P/S = market cap / `revenues`; PEG = P/E / `eps_growth_%`; EV/EBITDA; EV/EBIT;
   - free-cash-flow yield = `fcff` / (market cap + debt − cash − short-term investments), with the company's market
     cap at its period-end price as above; CFO/revenue = `cfo` / `revenues`; dividend yield = the marketwatch
     `dividend_yield_perc` (today's, for everyone).

   Because the company is valued at its period-end close while its own entry in the sample uses today's price, its
   price-based values are usually absent from the sample: their percentile is then computed with `ties = 0` and can
   fall slightly outside 1–100.

   Our adapter (`get_financials` with `compareToSector`) does the same, requesting the same candle window, with one
   deviation: when the candles do not reach back to the period end it values the company at the current price and
   says so (`valuationPrice.reason = "beforeHistory"`, a note) instead of leaving the multiples empty. Thndr serves
   about 5 years of daily candles, so this only happens for a company whose latest reported period ended earlier
   than that. Candles that fail to load (an upstream error) also fall back to the current price, with a note.
3. For each metric, the sector sample keeps only truthy values (zero and missing values are dropped). The statistics
   are the median (the mean of the two middle values for an even count), the minimum and the maximum.
4. The percentile of the company's value in the ascending sample: `rank` = 1 + the count of values below it, `ties` =
   the count of equal values from there, `avg = rank + (ties − 1)/2`, percentile =
   `1 + ((lowerIsBetter ? n + 1 − avg : avg) − 1) × 99 / (n − 1)`; null when `n < 2`. Lower is better for P/E, P/B,
   P/S, PEG, EV/EBITDA, EV/EBIT, net debt/equity and net debt/EBITDA.
5. The category rating (financial health, efficiency, growth, profitability, valuation) is `Math.round(mean)` of the
   percentiles of the metrics with `includeInRating !== false`. Excluded: ROE, ROA, gross margin, P/S, PEG, dividend
   yield and the 3-year average growth rates. Colours: > 80 green, ≥ 60 light green, ≥ 40 yellow, ≥ 20 orange, else
   red. In `qoq` mode the 3-year averages are hidden. The panel is marked unsupported for sectors whose `eng_desc`
   contains "banks".

#### 8b. `GET x.thndr.app/api/macros`: Egypt macro data [C] [live-verified 2026-10-06]

Evidence: `lazy_1328.9766ec277aa6dc9e.js:549`. No parameters.

```ts
interface MacrosResponse {
  metadata: {
    description: string;   // "Egypt Macroeconomic Data"
    extracted_at: string;  // "2026-09-07T17:30:38.750981"
    sources: Record<"overnight_rates" | "unemployment" | "inflation_monthly" | "inflation_yearly" | "treasury_bills", string>;
  };
  overview: {
    headline_inflation_yearly: { value: number; date: string; growth: number };  // growth: change from the previous reading [I]
    core_inflation_yearly: { value: number; date: string; growth: number };
    unemployment: { value: number; period: string /* "Q2 2026" */; growth: number };
    deposit_rate: { value: number; date: string; growth: number };
    lending_rate: { value: number; date: string; growth: number };
    treasury_bills_12m: { value: number; date: string; growth: number };
    gdp: { gdp_egp: number; gdp_usd: number; gdp_growth_egp: number; gdp_growth_usd: number };
  };
  overnight_rates: { date: string; deposits_rate: number; lending_rate: number }[];  // CBE decisions
  unemployment: { year: number; quarter: number; rate: number }[];                  // quarterly
  inflation_monthly: { date: string; headline: number; core: number; goods_and_services: number; fruits_and_vegetables: number }[];
  inflation_yearly: { date: string; headline: number; core: number; goods_and_services: number; fruits_and_vegetables: number }[];
  treasury_bills: { date: string; "1m_return": number; "3m_return": number; "6m_return": number; "9m_return": number; "12m_return": number }[];
}
```

Values are in percent. The arrays were observed oldest first (we sort them anyway).

#### 8c. `GET https://prod.thndr.app/api/post/news/`: news [C] [live-verified 2026-10-06]

Client `aP` with `authorizationAuth`, so the UI sends `Authorization: Auth <full_access>`. `Bearer <full_access>`
works too, and is what we send. Evidence: `chunks_4856-b1391c64ea89d9ab.js:1512-1530`; fields read at `:1689-1720`.

- Params: `asset_id` (omit it for market-wide news across Thndr's markets, e.g. `egypt` and `us`: 166k items on
  2026-10-06), `locale` (`en|ar`), `page` (1-based, 25 per page). There is no market filter: a `market` parameter
  is ignored and market-wide pages mix EGX and US items (live-verified 2026-10-06).
- Pagination: Django REST. `next` is null on the last page; a page past the end answers 404 (`Invalid page.`) [I].

```ts
interface NewsResponse { count: number; next: string | null; previous: string | null; results: NewsItem[] }
interface NewsItem {
  id: number;
  stocks: { symbol: string; id: number; asset_id: string; asset_class: string }[];
  title: string;
  content: string;      // a summary; "" for many EGX disclosures (the text is the PDF behind `link`)
  created_at: string;   // "2026-08-20T09:55:27+03:00"
  locale: "en" | "ar";
  market: "egypt" | "us" | string;
  link: string;         // an EGX bulletin PDF or the article URL
  external_id: string;
  source: string;       // "egx", "The Motley Fool", …
  source_logo: string;
  image: string;
}
```

### 9. Unleash feature flags [C]

Evidence: `chunks_main-app-accef77520b86eec.js:57-73` (`unleash-proxy-client` `UnleashClient`).

```js
new UnleashClient({ url:"https://unleash.thndr.app/proxy", clientKey:"jU99iOlkjauiwe", refreshInterval:15,
  appName:"thndrx", environment:"prod", context:{ properties:{ appId: NEXT_PUBLIC_APP_ID } },
  bootstrap: localStorage["unleash:repository:repo"], bootstrapOverride:false })
```

- After login the context gets `userId=<uid>` and `properties.tags=[...]` from `/users-service/tags`.
- **Probe:** `GET https://unleash.thndr.app/proxy?appName=thndrx&environment=prod` with header `Authorization: jU99iOlkjauiwe`.
  - Without any user context it returns HTTP 200 `{toggles:[{name,enabled,variant:{name,enabled}}]}`.
  - The anonymous response lists 626 enabled toggles shared across all Thndr apps.
  - It returns only enabled toggles. A flag missing from the response is off.

Flags the web app reads, with their anonymous state at probe time:

| Flag | Anonymous state | Effect |
|---|---|---|
| `thndrx_enable_asset_price_feed` | **ON** | RTDB path `assetPrice/{id}/price/last/value` and `assetPrice/{id}/day_snapshot/last/previous_close`. When off, the paths are `marketFeed/{id}/price` and `marketFeed/{id}/previous_close`. |
| `thndrx_tables_use_security_data_store` | off | Fills the securities store from marketwatch. |
| `thndrx_use_trades_book_v3` | ON | Trades-book version. |
| `thndrx_enable_saving_tv_templates` | ON | `/tvcharts/v1/drawing-templates`. |
| `thndrx_use_home_page_v2` | ON | |
| `thndrx_web_rumble_account_linking` | ON | |
| `thndrx_web_rumble_hub` | ON | |
| `thndrx_orders_enable_t0_market_sell` | ON | |
| `thndrx_orders_enable_t1_market_sell` | ON | |
| `thndrx_mobile_lists_tab` | ON | |
| `thndrx_enable_rum` | ON | |
| `thndrx_web_rumble_subscription_banner` | off | |
| `thndrx_orders_disable_t0_orders` | off | |
| `thndrx_orders_disable_t1_orders` | off | |
| `thndrx_enable_waf_experiment` | off | |
| `thndrx_enable_debug_logs` | off | |
| `thndrx_enable_replays` | off | |
| `thndrx_enable_rum_replays` | off | |
| `thndrx_enable_targeted_rum` | off | |
| `thndrx_enable_targeted_replays` | off | |
| `thndrx_enable_targeted_error_replays` | off | |

Other enabled server-side flags hint at backend behaviour:
- `service_assets-trades-candles-from-feed-historicals-enabled`
- `mobile_securities_serve_charts_from_candles_trades`
- `mobile_securities_realtime_feed_asset_price_path`
- `mobile_charts_1d_1min`
- `mobile_securities_eg_use_price_alerts_service`

### 10. TradingView persistence (brief) [C]

Evidence: `chunks_2987-84112a189893841f.js:773-810,955-1037,1089-1118`.

| Method | Client | Path | Body / params | Response |
|---|---|---|---|---|
| GET | aP | `/users-service/tvcharts/layouts` | – | layout list [I] (records with `id`, `name`, `modified_iso`…) |
| GET | aP | `/users-service/tvcharts/layouts/{layoutId}` | – | layout [I] |
| POST | aP | `/users-service/tvcharts/layouts` | `{ layout }` | created layout (`id`) [I] |
| PATCH | aP | `/users-service/tvcharts/layouts/{layoutId}` | `{ layout }` | layout |
| DELETE | aP | `/users-service/tvcharts/layouts/{layoutId}` | – | – |
| GET | aP | `/users-service/tvcharts/drawings/{assetId}` | – | drawings for that asset [I] |
| POST | aP | `/users-service/tvcharts/drawings/{assetId}` | `{ drawings }` | – |
| DELETE | aP | `/users-service/tvcharts/drawings/{assetId}` | – | – |
| GET | Kc | `/tvcharts/v1/indicator-defaults` | – | `{ indicator_defaults: {indicator:string, default_setting:any}[] }` |
| PUT | Kc | `/tvcharts/v1/indicator-defaults` | `{ indicator, default_setting }` | – |
| DELETE | Kc | `/tvcharts/v1/indicator-defaults?indicator=X` | – | – |
| GET | Kc | `/tvcharts/v1/drawing-templates/{toolName}` (URL-encoded) | – | template list for the tool [I] |
| GET | Kc | `/tvcharts/v1/drawing-template/{templateId}/content` (note: singular) | – | content |
| PUT | Kc | `/tvcharts/v1/drawing-templates` | `{ tool_name, template_name, content }` | template |
| DELETE | Kc | `/tvcharts/v1/drawing-templates/{templateId}` | – | – |

Drawing-template endpoints are gated by `thndrx_enable_saving_tv_templates`. Template errors map `detail.type` to UI messages.

TradingView config [C] (`chunks_2987:3420-3445`):
- `supported_resolutions`: `["1","5","10","15","30","60","240","1D","1W","1M"]`
- Currency codes: `USD`, `EGP`
- `time_frames` (label → resolution): 1D → 1, 1W → 5, 1M → 60, 6M → 1D, 1Y → 1W, 5Y → 1M.

---

## 9. ThndrX analyst content ("Rumble" advisory): `/thndrx/*`

> Status legend: **[C]** confirmed from the bundle (exact string or code), **[I]** inferred from UI usage (field names were read from the code, but types and nullability are guesses), **[?]** unknown.
> No network probing was done for this section.

### 0. Important: these endpoints are NOT on prod.thndr.app

Every `/thndrx/*` content call (other than `/thndrx/link*`, which is out of scope) goes through client **`VA`** (module 2938, local `ei`). **[C]**

| Item | Value |
|---|---|
| Base URL | `https://therumble.app/api` (`Q = "https://therumble.app/api"`, chunks_3515 ~l.414) |
| Auth header | `Authorization: Bearer <RUMBLE access token>` (request interceptor `X` → `$`) |
| Extra headers | `x-thndrx-runtime-version: <major.minor.patch>`, `X-Correlation-ID: <uuid>`. Also `X-Language: ar\|en`, sent whenever the call sets `includeLanguageHeader: true`; nearly all content calls do. |
| Response interceptor | `M.r4` only logs the response. It does not unwrap envelopes and does not convert case. On 401/403, `j` refreshes the Rumble token and retries once. |
| Advisory gate | Interceptor `K` (see §0.2). Requests to URLs starting with `/thndrx/link` skip it. |

So "ignore VA" does not apply to the analyst content: it is all hosted on therumble.app.

#### 0.1 Getting a Rumble token (chunks_3515 module 73879) [C]
1. **Mint:** `POST /api/auth/rumble-exchange`, with **no body**, on client `zC`. `zC` is `https://x.thndr.app/api` and uses the full-access Bearer token. The response is passed to `R(e)`, so it is `{ accessToken, refreshToken, expires_in, refresh_expires_in }`.
   ```js
   let { data: e } = await o.zC.post("/auth/rumble-exchange");
   return R(e), ... "RUMBLE::EXCHANGE::Token exchanged successfully"
   ```
2. **Refresh:** `POST https://therumble.app/api/auth/thndrx/refresh`, body `{ refreshToken }`, on client `yS` (no auth). The response is `{ accessToken, refreshToken, expires_in, refresh_expires_in }`.
3. The access token is a JWT. Its claims include `linkState` (for example `"LINKED_ACTIVE"`), `entitlements: string[]`, `rumble_uid`, `thndr_email` and `rumble_email` (modules 70071 and 73879).

#### 0.2 Advisory gate semantics (module 76636; interceptor `K` in module 2938) [C]
```js
async function K(e) {
  if (e.url?.startsWith("/thndrx/link")) return e;
  let t = P.v.isEnabled("thndrx_web_rumble_account_linking");   // unleash flag
  if (!t) return e;
  if (null === claims && await refreshRumble(), Is(claims, t)) // advisory === "NONE"
     return { ...e, signal: AbortSignal.abort("...Rejected a request from a claim with no advisory") };
  return e;
}
```
- The advisory level is computed from the entitlements:
  - `all-advice` or `fundamental-advice` → FUNDAMENTAL
  - `all-advice` or `technical-advice` → TECHNICAL
  - both → `BOTH`; neither → `NONE`
  ```js
  function U(e){let t=e?.entitlements??[],r=t.includes("all-advice")||t.includes("fundamental-advice"),n=t.includes("all-advice")||t.includes("technical-advice");return r&&n?"BOTH":r?"FUNDAMENTAL":n?"TECHNICAL":"NONE"}
  ```
- While the flag is on, the client cancels every content request locally when the advisory is `NONE`.
- The UI only shows each surface for certain advisory levels (`T1()`):
  ```js
  CALLS: ["BOTH","FUNDAMENTAL","TECHNICAL"], COVERAGE: ["BOTH","FUNDAMENTAL"],
  PORTFOLIOS: ["BOTH","FUNDAMENTAL"], WATCHLISTS: ["BOTH","TECHNICAL"]
  ```
  A surface is visible when `!flag || advisory==="NONE" || list.includes(advisory)`.
- We expect the server to enforce the same rules (403 when not entitled) **[I]**.

#### 0.3 Shared conventions [C]
- **Market codes are Rumble's own**, not ThndrX's. They come from module 86273 (chunks_5049:684):
  ```js
  { egypt:"EGY", simulator:"EGY", us:"USA", adsm:"UAE", abudhabi:"UAE" }
  ```
- **List envelope:** `{ objects: T[], pagination: { total: number, ... } }`.
- **Pagination is skip/limit.** The next `skip` is the sum of `objects.length` across loaded pages while that sum is below `pagination.total`:
  ```js
  function G(e,t){let l=e.pagination?.total??0,a=t.reduce((e,t)=>e+t.objects.length,0);return a<l?a:void 0}
  ```
- **Single-object envelope:** `{ object: T }`. Every query selects it with `select: e => e.object`.
- **Field naming:** mostly snake_case. The exception is the camelCase track-record stats.
- **Rich text:** fields named `document` hold a rich-text JSON document, rendered by module 32403 (`content: x.document`) **[I: probably a TipTap/ProseMirror-style doc]**.

```ts
interface RumbleList<T> { objects: T[]; pagination: { total: number; [k: string]: unknown } }
interface RumbleSingle<T> { object: T }
type RumbleMarket = "EGY" | "USA" | "UAE";
interface RichDoc { document: unknown }        // [I]
```

---

### 1. Experts

#### 1.1 `GET /thndrx/experts` (VA) [C]
- **Evidence:** lazy_3602:43
  ```js
  await n.VA.get("/thndrx/experts",{params:{scope:"all",limit:30},headers:{includeLanguageHeader:!0}})
  ... return e.objects
  ```
- **Query:** `scope=all`, `limit=30`.
- **Pagination:** the code comments that pagination "is not supported". It warns when `pagination.total >= 30`.
- **Filtering:** done client-side, by `e.markets.includes(market)` and `types.includes(e.type)`.

```ts
type ExpertType = "FUNDAMENTAL_ANALYST" | "TECHNICAL_ANALYST" | "CONTENT_CREATOR"; // [C] chunks_5049 ~l.187
interface Expert {
  id: string;            // [C] (e.id; filters send expert ids)
  name: string;          // [C]
  nickname?: string;     // [C] used in calls empty-state text (lazy_1055)
  image?: string;        // [C] avatar URL
  type: ExpertType;      // [C]
  bio?: string;          // [C] (detail)
  markets: RumbleMarket[]; // [C] e.markets.includes(t)
}
```

#### 1.2 `GET /thndrx/experts/{expertId}` (VA) [C]
- **Evidence:** chunks_5049:139
  ```js
  h.VA.get(`/thndrx/experts/${e}`,{params:{market:t,period:a},headers:{includeLanguageHeader:!0}})
  ```
  The UI calls it with `period:"3m"` (`queryKey ["rumble-expert", id, market, "3m"]`).
- **Query:** `market` (RumbleMarket), `period` (TrackRecordPeriod).
- **Response:** `RumbleSingle<ExpertDetail>`.

```ts
type TrackRecordPeriod = "1m" | "3m" | "6m" | "1y" | "alltime";  // [C] let f = ["1m","3m","6m","1y","alltime"]
interface ExpertDetail extends Expert {
  trackRecord?: TrackRecord;   // [C] C.trackRecord (camelCase key)
}
```

#### 1.3 `GET /thndrx/track-record` (VA) [C]
- **Evidence:** chunks_5049:205
  ```js
  h.VA.get("/thndrx/track-record",{params:{expert_id:e,market:t,type:a,period:l}})
  ```
- **Query:** `expert_id`, `market`, `type` (`"technical"|"fundamental"`, taken from `trackRecord.type`), `period`.
- **When the UI calls it:** only when the period is not `3m`. For `3m` it reuses `expert.trackRecord`. The period selector is shown only when `type === "technical"`.

```ts
interface TrackRecord {
  type: "technical" | "fundamental";     // [C] n.type
  object: {                               // [C] note nested `object`
    hitRatio: number;        // fraction; UI shows 100*x %  (technical)
    avgCallsReturn: number;  // fraction
    avgWin: number;          // fraction (technical)
    avgLoss: number;         // fraction (technical)
    callsCount: number;
    avgHoldingPeriod: number; // days
    avgIndexReturn: number;  // fraction (fundamental)
    avgCallsAlpha: number;   // fraction (fundamental)
  };
}
```
**[I]** We assume the endpoint returns this same `TrackRecord` object, because it is substituted directly for `expert.trackRecord`.

---

### 2. Calls (trade ideas)

#### 2.1 `GET /thndrx/calls` (VA) [C]
- **Evidence:** lazy_1055:1500
  ```js
  W.VA.get("/thndrx/calls",{params:e,headers:{includeLanguageHeader:!0}})
  ```
  Here `e = { status, experts, actions, market, sort_order, skip, limit: 30 }`.
- **Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `status` | `"open" \| "closed"` | Widget default is `"open"`. **[C]** (`statusFilter:"open"`, items keyed `open`/`closed`) |
| `experts` | `string[]` | Expert ids. Serialized by axios default as `experts[]=a&experts[]=b` **[I]**. |
| `actions` | `CallAction[]` | Omitted when empty. |
| `market` | RumbleMarket | |
| `sort_order` | `"asc" \| "desc"` | Optional. **[I]** values |
| `skip` | number | Default 0. |
| `limit` | number | 30 |

- **Response:** `RumbleList<CallSummary>`.

```ts
type CallType = "fundamental" | "technical";                       // [C]
type CallStatus = "open" | "closed";                               // [C]
type CallAction = "invest" | "buy" | "hold" | "take_profit" | "sell"; // [C] filter list ["invest","buy","hold","take_profit"] + pill styles incl. "sell"
// UI maps fundamental "buy" -> "invest": od(e,t) => t==="fundamental"&&e==="buy" ? "invest" : e
interface RumbleAsset {
  symbol: string; icon?: string;
  feed_provider_id: string;   // = ThndrX asset id (used with link-1 updateAssetId / Firebase price feed)
  currency: string;           // e.g. "EGP" (lower-cased for i18n)
  dividends?: { ex_date: string; dividend_per_share: number }[];  // [C] module 60134
}
interface CallSummary {
  id: string;
  type: CallType;
  status: CallStatus;
  asset: RumbleAsset;
  experts: Expert[];                  // [I] subset of Expert
  fundamental_action?: CallAction;    // when type==="fundamental"
  technical_action?: CallAction;      // when type==="technical"
  start_price: number;                // column "start_price"
  close_price?: number | null;        // column "close_price"
  target_price?: number;              // column "target_price"
  first_published_at: string;         // ISO
  last_update_published_at: string;   // ISO; != first_published_at => "updated"
  closed_at?: string | null;          // duration = closed_at - first_published_at
  performance?: number | null;        // [I] fraction
}
```
The UI derives a display status:
```js
function i({createdAt,updatedAt,callStatus,callType}){return "closed"===callStatus?"closed":createdAt!=updatedAt?"updated":"fundamental"===callType?"released":"opened"}
```

#### 2.2 `GET /thndrx/calls/fundamental/{callId}` (VA) [C]
- **Evidence:** lazy_1055:857. No params. Response is `RumbleSingle<FundamentalCall>`.
- **Field evidence:** lazy_1055 ~880-972.

```ts
interface CallDetailBase extends CallSummary {
  action?: CallAction;               // [C] _.action
  close_at?: string | null;          // [C] (detail uses close_at)
  index?: unknown;                   // [C] benchmark index (shape [?])
  start_index_price?: number;        // [C]
  close_index_price?: number | null; // [C] index change = (close-start)/start*100; alpha = 100*performance - indexChange
  performance?: number | null;       // [C] fraction (es = 100 * performance)
  the_story?: RichDoc;               // [C] rendered via h.document
}
interface FundamentalCall extends CallDetailBase {
  take_profits?: { published_at: string; realized_percentage: number; realized_price: number }[]; // [C] module 60134
}
```

#### 2.3 `GET /thndrx/calls/fundamental/{callId}/updates` (VA) [C]
- **Evidence:** lazy_1055:733
  ```js
  W.VA.get(`/thndrx/calls/fundamental/${e.id}/updates`,{params:e,...})
  ```
  The UI sends `{ id, limit: 10, skip, sort_order: "desc" }`. Note that `id` is also sent as a query param.
- **Response:** `RumbleList<CallUpdate>`.

```ts
interface CallUpdate { id: string; title: string; first_published_at: string; content?: RichDoc } // [C] title, first_published_at; [I] content
```

#### 2.4 `GET /thndrx/calls/technical/{callId}` (VA) [C]
- **Evidence:** lazy_8991:690. No params. Response is `RumbleSingle<TechnicalCall>`.

```ts
interface TechnicalCall extends CallDetailBase {
  buy_range_start?: number;   // [C]
  buy_range_end?: number;     // [C]
  stop_loss?: number;         // [C] (shape [I] number)
  updates?: CallUpdate[];     // [C] inline updates (no separate endpoint used)
}
```

---

### 3. Coverage (research reports)

#### 3.1 `GET /thndrx/coverage` (VA) [C]
- **Evidence:** lazy_9332:811
  ```js
  y.VA.get("/thndrx/coverage",{headers:{includeLanguageHeader:!0},params:{tags,assets,sectors,experts,markets,skip,limit}})
  ```
- **Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `tags` | `string[]` | Tag slugs. |
| `assets` | `string[]` | Asset ids (`e3 = e => e.id`). |
| `sectors` | `string[]` | Sector slugs. |
| `experts` | `string[]` | Expert ids. |
| `markets` | `RumbleMarket[]` | The UI sends a single-element array. |
| `skip` | number | |
| `limit` | number | The UI uses 10. |

- **Response:** `RumbleList<CoverageItem>`. Paging stops when `objects.length === 0`.
- **UI behaviour:** the expert filter only lists `FUNDAMENTAL_ANALYST` experts.

```ts
type CoverageTagSlug = "call" | "earnings-recap" | "deep-dive" | "macro-strategy" | "economic-update" | "ipo" | "sector-thematic"; // [C] colour map P
interface CoverageTag { slug: CoverageTagSlug | string; name: string }   // [C] a.tag.slug / a.tag.name
interface CoverageSector { slug: string; name: string }                   // [I] id/slug/name seen
interface CoverageCompany { id: string; symbol: string }                  // [C] e.symbol.toUpperCase(), e.id
interface CoverageItem {
  id: string;
  title: string;
  short_description?: string;
  publish_date: string;                 // ISO
  experts: Expert[];
  tag: CoverageTag;
  tags?: CoverageTag[];                 // [?] seen once
  sectors: CoverageSector[];
  companies: CoverageCompany[];
  impact_scope: "market" | string;      // [C] "market" => market-wide (shows all companies)
}
```

#### 3.2 `GET /thndrx/coverage/{id}` (VA) [C]
- **Evidence:** lazy_9332:175. No params. Response is `RumbleSingle<CoverageDetail>`.

```ts
interface CoverageDetail extends CoverageItem { update: { content: RichDoc } }  // [C] y.update.content.document
```

#### 3.3 `GET /thndrx/coverage/sectors?market=<RumbleMarket>` (VA) [C]
- **Evidence:** lazy_9332:1031. Response is `RumbleList<CoverageSector>`; the UI selects `.objects`.

#### 3.4 `GET /thndrx/coverage/tags` (VA) [C]
- **Evidence:** lazy_9332:1396. No params. Response is `RumbleList<CoverageTag>` (`.objects`).
- **UI behaviour:** the UI adds a local pseudo-option `__my_companies__` ("My companies"). It is not an API value.

---

### 4. Model portfolios

#### 4.1 `GET /thndrx/portfolios` (VA) [C]
- **Evidence:** lazy_9487:246 (params passed through) and lazy_9487:1273
  ```js
  I({ type: o, experts: a, market: i, skip: t ?? 0, limit: 10 })
  ```
- **Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `type` | `"fundamental"` | The only value seen (`eO type:"fundamental"`). `"technical"` is plausible **[I]**. |
| `experts` | `string[]` | Optional. |
| `market` | RumbleMarket | |
| `skip` | number | |
| `limit` | number | 10 |

- **Response:** `RumbleList<PortfolioSummary>`.

```ts
type PortfolioAssetStatus = "NEW" | "REMOVED" | string;   // [C] filters "REMOVED", badges "NEW"
interface PortfolioAsset extends Partial<RumbleAsset> {
  id: string; symbol: string; icon?: string; feed_provider_id: string;
  status?: PortfolioAssetStatus;
  entry_date?: string;                 // [C] column, sorted by entry_date
  name?: string;                       // [I]
}
interface PortfolioSummary {
  id: string;
  name: string;
  experts: Expert[];
  assets: PortfolioAsset[];             // holdings = assets.filter(a => a.status !== "REMOVED")
  returns?: number;                     // [C] shown as % (k.returns)
  first_published_at?: string;
  last_update_published_at: string;
  last_update?: { returns?: number; index_performance?: number; alpha?: number }; // [C] destructured
}
```

#### 4.2 `GET /thndrx/portfolios/{id}` (VA) [C]
- **Evidence:** lazy_9487:1162. Response is `RumbleSingle<PortfolioDetail>`.
- **UI tabs:** stocks, updates, performance, methodology.

```ts
interface PortfolioDetail extends PortfolioSummary {
  performance?: RichDoc | null;  // [C] performanceContent.document
  methodology: RichDoc;          // [C] methodology.document
}
```

#### 4.3 `GET /thndrx/portfolios/{id}/updates?limit=10&skip=N` (VA) [C]
- **Evidence:** lazy_9487:549. Response is `RumbleList<PortfolioUpdate>`.

```ts
interface PortfolioUpdate {
  id: string; title: string; first_published_at: string;
  assets_diff: unknown[];   // [C] rendered as TickerChips (items: c.assets_diff) — likely {symbol, status/change}[] [I]
}
```

---

### 5. Weekly technical watchlists (`/thndrx/watchlists`, not the user watchlists in users-service)

#### 5.1 `GET /thndrx/watchlists` (VA) [C]
- **Evidence:** lazy_6648:352
  ```js
  H.VA.get("/thndrx/watchlists",{params:{market:e,week_start:t,skip:s,limit:a}})
  ```
- **Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `market` | RumbleMarket | |
| `week_start` | `YYYY-MM-DD` | Format `g = "YYYY-MM-DD"`. The week start is computed in Africa/Cairo time from a per-market calendar (see below). |
| `skip` | number | |
| `limit` | number | |

- **Per-market week calendar [C]:**
  ```js
  EGY:{weekStart:0,lastTradingDay:4,rolloverDay:5}, UAE:{weekStart:1,lastTradingDay:5,rolloverDay:6}, USA:{weekStart:1,lastTradingDay:5,rolloverDay:6}
  ```
  The `weekStart` value is a day of the week, where 0 is Sunday.
- **Response:** `RumbleList<RumbleWatchlist>`.

#### 5.2 `GET /thndrx/watchlists/{id}` (VA) [C]
- **Evidence:** lazy_6648:1071. Response is `RumbleSingle<RumbleWatchlist>`.

```ts
type WatchStockStatus = "watching" | "triggered" | "invalidated" | "removed" | "closed"; // [C] colour map eA
type ConditionRole = "trigger" | "invalidation" | "target_price" | "stop_loss";          // [C]
// watching/closed/invalidated/removed show [trigger, invalidation] then [target_price, stop_loss]; triggered shows the reverse
interface WatchCondition { role: ConditionRole; type: string; value: number; duration?: number /* days */ } // [C] v.type/v.value/v.duration
interface RumbleWatchlistStock {
  id: string;
  asset: RumbleAsset;
  status: WatchStockStatus;
  conditions: WatchCondition[];
  comment?: string;
  updated_at?: string;
  triggered_call_id?: string | null;   // opens technical call when triggered/closed
  video_start_min?: number; video_start_sec?: number;  // seek offset in the Vimeo video
  symbol?: string;                      // [C] list card uses stock.symbol/status
}
interface RumbleWatchlist {
  id: string;
  week_start: string;                   // YYYY-MM-DD
  experts: Expert[];                    // card shows experts[0].name
  vimeo_id?: string;                    // embedded video
  stocks: RumbleWatchlistStock[];
  updates: { id: string; created_at: string; summary: string }[];  // [C] eL()
  title?: string; status?: string; created_at?: string;            // [I]
}
```

---

### 6. Related Unleash flags (names only) [C]
- `thndrx_web_rumble_account_linking`: turns on the advisory gate and the per-surface visibility rules.

### 7. Gaps / unknowns
- The exact shapes of `index` (call benchmark), `stop_loss` (technical), and portfolio `assets_diff` items.
- Whether the server accepts other filter values, such as `type=technical` for portfolios, or a `sort_order` on `/thndrx/calls`.
- **Array query-param serialization.** Clients `VA`/`ei` set no `paramsSerializer`, so axios 1.x sends `experts[]=a&experts[]=b` (bracket style). Verify that the server also accepts repeated keys.
- **Error envelope:** not observed for therumble.app. ThndrX core uses `{detail:{msg,type}}`.
