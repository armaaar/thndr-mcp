# ThndrX private API: account, portfolio, orders, funding, journal, market status

Source: de-minified ThndrX web bundles (`re/pretty/*.js`), plus unauthenticated probes of `prod.thndr.app` made on 2026-10-06.
Legend:
- **[C]**: confirmed. The literal URL, method, params or body appears in code, or a probe showed it.
- **[I]**: inferred from how the UI reads the data (field names are real, but types and optionality are guesses).
- **[?]**: unknown or speculative.

All JSON is **snake_case on the wire**. The axios interceptors do **no** case conversion and **no** envelope unwrapping. Call sites read `res.data` directly. The one exception is the KrakenD error-in-200 detection described in section 0.4.

---

## 0. Transport, clients, auth, errors

### 0.1 Axios clients (module 2938, `chunks_3515-3f5b9465a524d3e5.js`)

| export | var | baseURL | auth (request interceptor) | response interceptor |
|---|---|---|---|---|
| `aP` | `J` | `https://prod.thndr.app` | full-access JWT, `Authorization: Bearer <token>` (fn `m` then `I`) | `M.r4` (log only) + 401/403 refresh-and-retry (`_`) |
| `Kc` | `ee` | `https://prod.thndr.app/krakend-thndr-x` | full-access Bearer | `M.p4` (KrakenD error-in-body detection) + 401/403 refresh |
| `kQ` | `et` | `https://prod.thndr.app` | limited-access Bearer (from `POST /auth-service/v2/tokens/limited-access`) | `M.r4` |
| `pu` | `er` | `https://prod.thndr.app` | none | `M.r4` |
| `th` | `en` | `https://prod.thndr.app` | Firebase token injected into the **body** as `credentials.firebase_token` (POST/PATCH/PUT) | `M.r4` |
| `hC` | `ea` | `/api` (Next.js on x.thndr.app) | Firebase `Authorization: Bearer` | `M.r4` |
| `Z$` | `es` | `/api` | none (used for `POST /api/auth/refresh`, which relies on a cookie) | `M.r4` |
| `zC` | `ec` | `/api` | full-access Bearer | `M.r4` + refresh |

**Every endpoint in this spec uses `aP` (direct `prod.thndr.app`) or `Kc` (KrakenD gateway).** [C]

### 0.2 Headers sent on every request [C]

Request interceptor `M.Ff` and fn `z`:
```
Authorization: Bearer <full_access_jwt>
X-Correlation-ID: <uuid v4>                 // M.Ff -> 37532.lk() -> uuid
x-thndrx-runtime-version: 3.8.3             // module 55705 {"rE":{"major":3,"minor":8,"patch":3}}
Content-Type: application/json              // axios default for bodies
```
- The CORS preflight on `prod.thndr.app/market-service/orders` returns `access-control-allow-headers: authorization,content-type,x-correlation-id,x-thndrx-runtime-version` and `access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT`. [C, probe]
- KrakenD `/krakend-thndr-x/savings/v1/clouds` preflight allows `authorization,x-correlation-id,x-thndrx-runtime-version` with method `GET`. [C, probe]
- `X-Language: ar|en` is sent only when a call sets `headers.includeLanguageHeader`. None of the endpoints in this spec do. [C]
- A server-to-server client probably does not need `x-thndrx-runtime-version` or `X-Correlation-ID`, but sending them is harmless. [I]

Full-access token lifecycle (for context; logging in is out of scope):
- The token is stored client-side. Its expiry is set as now + 15 min.
- Refresh is `POST https://x.thndr.app/api/auth/refresh` with cookies (`withCredentials`). The response is `{ auth_token }`. [C]
- Refresh failure types: `INVALID_REFRESH_TOKEN`, `MISSING_REFRESH_TOKEN`, `EXPIRED_REFRESH_TOKEN`. [C]

### 0.3 Error shapes (probed) [C]

`prod.thndr.app/market-service/*` without a token (FastAPI style):
```http
HTTP/2 401
www-authenticate: Bearer
{"detail":"Not authenticated"}
```
`market-service` with a bad token:
```json
{"detail":{"msg":"Invalid token","type":"INVALID_TOKEN"}}
```
`funding-service` and `payment-service` with no or a bad token return **403**:
```json
{"detail":{"msg":"Authentication token is invalid","type":"INVALID_TOKEN","extras":{}}}
```
KrakenD (`/krakend-thndr-x/...`) without a token returns `401` with an **empty body**.

Business errors: the UI reads `error.response.data.detail.type`, a string code, for example in `chunks_6088` `e_()`:
```js
onError(e) { e instanceof ex.pe ? l?.(e?.response?.data?.detail?.type) : l?.(void 0) }
```
So a generic error looks like this:
```ts
interface ThndrError { detail: string | { msg: string; type: string; extras?: Record<string, unknown> } }
```

### 0.4 KrakenD error-in-200 envelope (`M.p4`, module 61199) [C]

KrakenD may return **HTTP 200** with a body whose top-level key names a failed backend:
```js
l = ["error_error_feed-historicals-service","error_price_alerts","error_asset_day_snapshot","error_asset_price",
     "error_asset_metadata","error_full_trades","error_partial_sells","error_trading_metrics","error_security_position",
     "error_get_clouds","error_transfer_types_clouds","error_calculate_transfer_fees","error_external_transfer",
     "error_update_cloud_transfer_request","error_transactions_clouds","error_clouds_stats", ...notifications]
function p(e){ let t = e.data && l.find(t => t in e.data);
  if (t) { let r = e.data[t]; /* r.http_body is a JSON string -> .detail {msg,type} ; r.http_status_code number */
           o = new AxiosError(a?.msg, a?.type, ...); o.status = r.http_status_code; reject } }
```
```ts
type KrakendErrorBody = Record<`error_${string}`, { http_status_code: number; http_body: string /* JSON: {detail:{msg,type}} */ }>;
```
**MCP implementation:** after any `Kc` call, check for a key starting with `error_`. If one exists, parse `http_body` and raise an error.

### 0.5 Common query param: `market` [C]

Almost every market-service call sends `?market=<Market>`. The default market in the app is `egypt` (`useState(g.C.EGYPT)`).
```ts
enum Market { SIMULATOR = "simulator", EGYPT = "egypt", US = "us", UAE = "adsm", ADX = "abudhabi" } // module 51487
```
Exchange or board codes (module 18291, `L`), used as `market_exchange`:
```ts
enum MarketExchange { OOTC = "OOTC", NOPL = "NOPL" /* EGX main board */, SME = "SME", INDX = "INDX", FNDS = "FNDS", ADSM = "adsm" }
enum AssetClass { STOCK = "STOCK", ETF = "ETF", INDEX = "INDEX", MANAGED_FUND = "FUND" }
```
Custodians (module 25973, `D0`): `"AUB" | "THN" | "OTHER"`.

---

## 1. Account and portfolio

### 1.1 `GET /market-service/accounts/wallet-and-portfolio` [C]

- Client: `aP`. Query: `market` (required).
- Evidence (`chunks_3073-1086eff233e85e69.js` module 25973):
  ```js
  return (await i.aP.get("/market-service/accounts/wallet-and-portfolio",{params:{market:a}})).data
  // then: e.portfolio?.positions?.forEach(e => t.setQueryData(["security-position", e.asset_id, a], e))
  ```
- React Query key `["balance", market]`, staleTime 2 min.

```ts
interface WalletAndPortfolio {             // [I] from consumers
  purchase_power: number;                  // "Buying power" (EGP)
  cash_in_holding: number;                 // "Blocked cash" (reserved by open buy orders)
  unsettled_cash: number;                  // "Unsettled cash"
  settled_cash?: number;                   // used by savings transfer (lazy_642)
  portfolio: {
    portfolio_value: number;               // market value of positions
    total_return: number;                  // EGP
    total_return_prc: number;              // percent
    positions: Position[];
  };
}
interface Position {                       // [I] (also the response of 1.2)
  asset_id: string;                        // UUID-like id used everywhere as asset id
  symbol: string;                          // ticker (e.g. "COMI")
  logo?: string;
  asset_class: "STOCK" | "ETF" | "INDEX" | "FUND";
  currency: string;                        // "EGP"
  unit?: "grams" | string;                 // "grams" => 4 decimals (gold funds)
  qty: number;
  cost_value: number;                      // total cost; avg price = cost_value / qty
  avg_cost?: number;                       // average entry price per unit
  market_price: number;
  gain_loss: number;                       // unrealized P/L EGP
  gain_loss_percentage: number;
}
```
UI formulas [C]:
- Total account value = `cash_in_holding + purchase_power + portfolio.portfolio_value + savings.total_amount`.
- Available cash = `purchase_power - unsettled_cash` (lazy_7810).

Evidence for the position mapping (`chunks_2987` `iD`):
```js
{ id:e.asset_id, symbol:e.asset_id, qty:e.qty, avgPrice:e.cost_value/e.qty, currency:e.currency, pl:e.gain_loss, costValue:e.cost_value }
```
And `lazy_8716` maps `e.symbol, e.logo, e.asset_class, e.currency, e.cost_value, e.avg_cost, e.qty, e.unit, e.market_price`.

### 1.2 `GET /portfolio/v1/position/{asset_id}` (KrakenD) [C]

- Client: `Kc`, so the full URL is `https://prod.thndr.app/krakend-thndr-x/portfolio/v1/position/{asset_id}?market=egypt`.
- Path param: `asset_id`. Query: `market`.
- 404 means no position; the UI returns `null`.
- The response is a single `Position` (same shape as 1.1). The UI swaps it into `balance.portfolio.positions` by `asset_id`.
- KrakenD error key: `error_security_position`.
- Evidence (`lazy_4199` module near line 845):
  ```js
  let {data:s} = await et.Kc.get(`/portfolio/v1/position/${e}`,{params:{market:r}});
  ... positions.map(r => r.asset_id === e ? s : r)
  catch(e){ if (isAxiosError(e) && e.response?.status === 404) return null; throw e }
  ```
- Fields the UI reads: `asset_id, qty, cost_value, gain_loss, gain_loss_percentage, market_price, unit`.

### 1.3 `GET /market-service/accounts/positions/blocked-quantities/{asset_id}` [C] (newly found)

- Client: `aP`. Query: `market`. Query key `["security-position-blocked", assetId, market]`.
- Used by the sell form to compute sellable quantity per settlement cycle and to pick the custodian.
- Evidence: `chunks_6088` `r_`.

```ts
interface BlockedQuantities {              // [I] keys from module 95396 enums R and C
  qty: number;           qty_blocked: number;
  qty_t0: number;        qty_blocked_t0: number;
  qty_t1: number;        qty_blocked_t1: number;
  qty_settled: number;   qty_blocked_settled: number;
  unsalable_qty: number; qty_blocked_unsalable: number;
  qty_per_custodian?:          CustodianQty[];
  qty_t0_per_custodian?:       CustodianQty[];
  qty_t1_per_custodian?:       CustodianQty[];
  qty_settled_per_custodian?:  CustodianQty[];
  unsalable_qty_per_custodian?: CustodianQty[];
}
interface CustodianQty { custodian: "AUB" | "THN" | "OTHER"; qty: number; qty_blocked: number }
```
UI logic [C]:
- Available = `qty_X - qty_blocked_X`.
- Custodian = `"AUB"` if `qty_settled_per_custodian` has an AUB entry, else `"THN"`.

### 1.4 `GET /market-service/realized-returns` [C]

- Client: `aP`. Query: `market`. Key `["returns", market]`.
- Evidence: `chunks_app_mobile_account_page` line 295.
```ts
interface RealizedReturns { total_returns: number; snapshot_date: string /* date */ }   // [I]
```

### 1.5 `GET /market-service/realized-returns/chart/{interval}` [C]

- Client: `aP`. Query: `market`. Path `interval`: `"1M" | "6M" | "1Y" | "2Y"` (enum in modules 84523 and 77767). [C]
- Live-verified 2026-10-06: `1W`, `3M`, `YTD`, `ALL` and `MAX` answer **HTTP 422**. Point counts: `1M` = 30 daily
  points, `6M` = 183 daily points (one per calendar day, weekends included), `1Y` = 52 weekly points, `2Y` = 105
  weekly points (same weekday, aligned between 1Y and 2Y). In the 2026-10-06 capture the `1M` series ran
  2026-09-06 → 2026-10-05 (latest point = the day before the request) and the `6M` series started 2026-04-06
  (`today − 6 months`), so a 6M window measured from the close before it needs one weekly point.
- Evidence: `lazy_1480` module 84523:
  ```js
  await s.aP.get(`/market-service/realized-returns/chart/${t}`,{params:{market:e}})
  ```
```ts
type ReturnsChart = Array<{        // live-verified 2026-10-06; array, oldest first
  snapshot_date: string;              // "YYYY-MM-DD"
  total_returns: number;              // cumulative realized returns
  portfolio_value: number;
  net_deposits: number;               // cumulative deposits − withdrawals (live 2026-10-06; not read by ThndrX's chart)
}>;
```
The UI reads `er[0][X ? "total_returns" : "portfolio_value"]` and `er.at(-1)?.snapshot_date`.

### 1.6 `GET /users-service/users/me` [C] (brief; profile)

- Client: `aP`. No params.
- Fields read: `first_name`, `last_name`, and others. Probably detailed in the auth/user spec.

### 1.7 `GET /payment-service/v2/subscriptions` [C]

- Client: `aP`. No params.
- The UI returns `data.results`.
- Evidence (`chunks_2801` near line 1405):
  ```js
  const {data:e} = await eL.aP.get("/payment-service/v2/subscriptions"); return e.results
  e.products?.includes("TRADER") && ("ACTIVE"===e.status || "TRIALING"===e.status)
  s && "MONTHLY"===s.frequency ? ... s.current_period_end : "YEARLY"===s.frequency ...
  ```
```ts
interface SubscriptionsResponse { results: Subscription[] }
interface Subscription {                 // [I]
  id?: string;
  products: Array<"TRADER" | "SPARK" | "EG_EXPRESS" | string>;  // product names also appear in activity descriptions
  status: "ACTIVE" | "TRIALING" | string;                        // others likely: CANCELED, PAST_DUE ...
  frequency: "MONTHLY" | "YEARLY";
  current_period_end: string;            // ISO date
}
```
Without a token this returns 403 `INVALID_TOKEN` (probe).

### 1.8 `GET /market-service/waived-commissions/used-count` [C]

- Client: `aP`. Query: `market`. Key `["orders","waived-orders-counter",market]`, staleTime 5 min.
- Evidence: `chunks_400` module 27403:
  ```js
  (await s.aP.get("/market-service/waived-commissions/used-count",{params:{market:e}})).data
  select: e => ({ executedOrders: e.count, pendingOrders: e.pending_orders_count, cycleStart: e.cycle_start })
  ```
```ts
interface WaivedCommissionsUsed { count: number; pending_orders_count: number; cycle_start: string /* date */ }
```
Semantics [C]:
- Only fetched when the user has an active or trialing `TRADER` subscription.
- The plan quota is **50 free (commission-waived) orders per cycle**: `remainingOrders = 50 - count`, `totalFreeOrders: 50`.
- Fee display: `thndrFees` counts as 0 while `executedOrders < 50` (`chunks_6088` `el`).
- Cycle renewal is `current_period_end` for MONTHLY plans, otherwise derived from `cycle_start`.

---

## 2. Market status and hours

### 2.1 `GET /market-service/markets/status` [C]

- Client: `aP`.
- Query:
  - `market` (`egypt`).
  - `market_exchange`: `NOPL` for the EGX main board; for a given stock it is that stock's `feed.market_id`, for example `OOTC`.
- Key `["market-status", market, exchange]`. Refetch interval is about 60 s.
- Evidence: `chunks_3073` module 55593:
  ```js
  await r.aP.get("/market-service/markets/status",{params:{market:a, market_exchange:t}})
  ```
```ts
interface MarketStatus {      // [I]
  is_active: boolean;         // market open now
  next_open_time?: string;    // ISO datetime; shown as "opens at" when !is_active
}
```
The endpoint is in the "quiet logging" list (`u` in 61199) because it is polled.

### 2.2 `GET /market-service/markets/hours` [C]

- Client: `aP`. Query: `market`. Key `["market-hours", market]`, staleTime 1 min.
- Only fetched while `status.is_active` is true.
- Evidence: `chunks_2801` module 31886.
```ts
interface MarketHours { session_open: string; session_close: string }   // [I] ISO datetimes (parsed with dayjs/new Date)
```
The UI computes progress `(now - open) / (close - open)` and shows "closes at h:mm A".

### 2.3 Hard-coded EGX sessions (TradingView datafeed, `chunks_2987` near line 3517) [C]
```js
EGYPT + NOPL : { exchange:"EGX",     timezone:"Africa/Cairo", session:"1;1000-1430:12345", session_holidays:"20260412,20260413" }
EGYPT + OOTC : { exchange:"EGX-OTC", timezone:"Africa/Cairo", session:"2;1200-1230:24" }
SIMULATOR    : { exchange:"SIM",     timezone:"Africa/Cairo", session:"1;1000-1430:12345" }
```
- TradingView day codes: 1=Sun … 7=Sat.
- **EGX main board:** Sunday to Thursday, 10:00 to 14:30 Cairo.
- **OTC:** Monday and Wednesday, 12:00 to 12:30.
- Server error codes also imply these phases: pre-open adjustment, pre-close auction, pre-close adjustment, pre-close trading (see section 3.10).

---

## 3. Orders and trading

### 3.0 Enums (module 95396 + 86385, `chunks_2022-deb1019ca110447e.js` lines 972+) [C]

```ts
enum OrderSide { BUY = "BUY", SELL = "SELL" }                    // field name on wire: order_type (!)
// "Order variant" is the boolean is_limit: true = LIMIT, false = MARKET
enum TimeInForce { DAY = "day", DATE = "date", GTC = "gtc", FOK = "fok", IOC = "ioc" }   // lowercase on wire
enum ExecutionType { DEFAULT = "DEFAULT", ALL_OR_NONE = "ALL_OR_NONE", MINIMUM_FILL = "MINIMUM_FILL", NO_FILL = "NO_FILL", FILL_OR_KILL = "FILL_OR_KILL" }
enum Settlement { T0 = "T0", T1 = "T1", SETTLED = "SETTLED" /* displayed "T+2" */ }
enum StopOrderType { Limit = "LIMIT", Market = "MARKET", StopLoss = "STOP_LOSS" }        // M7 (UI)
type BracketLegType = "Limit" | "Market";                                                // on wire inside order_pairs
enum StopOrderStatus { Active="Active", Inactive="Inactive", Triggered="Triggered", PendingTrigger="PendingTrigger", Cancelled="Cancelled", Failed="Failed" } // h6

// order_status (coarse) – Re
type OrderStatus = "QUEUED_SUBMIT" | "QUEUED_CANCEL" | "PENDING" | "CLOSED" | "COMPLETED" | /* + all detail values below */ string;
// order_status_details (fine) – _I
enum OrderStatusDetails {
  Pending="PENDING", PendingSubmit="PENDING_SUBMIT", PendingCancellation="PENDING_CANCELLATION", PendingQueuedCancel="PENDING_QUEUED_CANCEL",
  PendingMcdr="PENDING_MCDR", ApprovedMcdr="APPROVED_MCDR", RejectedMcdr="REJECTED_MCDR", Fulfilled="FULFILLED", PartiallyFilled="PARTIALLY_FILLED",
  Rejected="REJECTED", Expired="EXPIRED", Cancelled="CANCELLED", PartiallyCancelled="PARTIALLY_CANCELLED", LocallyCancelled="LOCALLY_CANCELLED",
  InsufficientFunds="INSUFFICIENT_FUNDS", InsufficientBalance="INSUFFICIENT_BALANCE", Suspended="SUSPENDED", InternalError="INTERNAL_ERROR",
  ExternalError="EXTERNAL_ERROR", TradeCancelled="TRADE_CANCELLED", NotExist="NOT_EXIST", PendingReplace="PENDING_REPLACE",
  PendingQueuedSubmit="PENDING_QUEUED_SUBMIT", LocallyRejected="LOCALLY_REJECTED", InsufficientShares="INSUFFICIENT_SHARES", Replaced="REPLACED", Processing="PROCESSING" }
enum DisableReason { INSUFFICIENT_BALANCE, NON_DAY_TRADEABLE, ASSET_NOT_OWNED }   // client-side only
```
The "open" set the client treats as active orders (`y` / `g` arrays) [C]: `PENDING, PARTIALLY_FILLED, PENDING_CANCELLATION, PENDING_MCDR, PENDING_QUEUED_CANCEL, PENDING_QUEUED_SUBMIT, PENDING_REPLACE, PENDING_SUBMIT, QUEUED_CANCEL, QUEUED_SUBMIT, PROCESSING`.

### 3.1 `GET /market-service/v3/orders` (list orders, cursor-paginated) [C]

- Client: `aP`.
- Evidence (same function duplicated in `chunks_2987` near line 3744, `lazy_1484` line 157, `lazy_4199` line 222):
  ```js
  let a = await c.aP.get("/market-service/v3/orders",{params:{
     market:e, status:t, cursor: ""===r ? void 0 : r, limit:i, sort_order:o, skip_funds:!0, asset_id:n }});
  return { orders:a.data.data, hasNext:a.data.has_next, cursor:a.data.cursor }
  // getNextPageParam: e => e.hasNext && e.cursor ? e.cursor : undefined
  ```

| param | type | notes |
|---|---|---|
| `market` | Market | required |
| `status` | `"PENDING" \| "COMPLETED" \| "CANCELLED" \| "CLOSED"` or omitted | Filter UI tabs: ALL (param omitted), PENDING ("open orders"), COMPLETED, CANCELLED, CLOSED ("past orders") [C, lazy_7241 near line 940; mobile trade page uses PENDING/CLOSED] |
| `cursor` | string | opaque; omit on the first page |
| `limit` | int | UI uses 10 (table) or 20 (fetch-all) |
| `sort_order` | `"DESC" \| "ASC"` | default `DESC` |
| `skip_funds` | bool | the UI always sends `true` [?: probably excludes mutual-fund orders] |
| `asset_id` | string | optional filter |

```ts
interface OrdersPage { data: Order[]; has_next: boolean; cursor: string | null }
interface Order {                                  // [I] union of all fields read by UI
  id: number | string;                             // String(e.id) used; numeric likely
  asset_id: string;
  stock_id: string;                                // UI displays it as the symbol in tables
  reuters_code?: string;
  logo?: string;
  asset_class?: string;
  order_type: "BUY" | "SELL";                      // side
  is_limit: boolean;
  order_class: "Bracket" | null | string;          // "StopOrder" is synthesized client-side (see below)
  amount: number;                                  // ordered quantity (shares)
  amount_filled?: number;                          // filled qty (meaningful when PARTIALLY_FILLED)
  price: number;                                   // limit price, or avg exec price when partially filled
  limit_price?: number;                            // present for partially filled: limit; then `price` = avg fill price
  order_status: OrderStatus;                       // coarse, e.g. "PENDING" | "COMPLETED" | "CLOSED"
  order_status_details: OrderStatusDetails;        // fine
  time_in_force: TimeInForce;
  time_in_force_date?: string;                     // ISO
  execution_type?: ExecutionType;
  minimum_fill_volume?: number;                    // [?] echoed from request
  settlement?: Settlement;                         // sells
  custodian?: "AUB" | "THN" | "OTHER";
  is_persistent?: boolean;
  is_editable?: boolean;                           // UI: !== false => editable
  is_cancelable?: boolean;
  order_pairs?: OrderPair[];                       // brackets (TP/SL)
  created_at: string;
  updated_at: string;
}
interface OrderPair {
  pair_id: string;
  take_profit?: BracketLeg;
  stop_loss?: BracketLeg;
}
interface BracketLeg {
  id: string | number;                             // stop_order_id used for cancel
  qty: number;
  trigger_price: number;
  limit_price: number;
  type: "Limit" | "Market";
  status?: StopOrderStatus;
}
```
Price display helpers (module 65270) [C]:
```js
Q0(e) = isPartiallyFilledNonStop(e) && e.limit_price != null ? e.limit_price : e.price       // displayed "price"
ID(e) = isPartiallyFilledNonStop(e) && limit_price != price (3dp) ? e.price : undefined         // displayed "avg price"
R(e)  = e.amount - (e.amount_filled ?? 0)  (remaining when PARTIALLY_FILLED, else amount)       // module 7324
```
The client synthesizes stop orders (functions `C`/`h`/`N`). For every Bracket order and every pair leg whose `status` is in the wanted set (default `[Active]`, or `[Active, Inactive, PendingTrigger]`), it emits a pseudo-row:
`{...order, order_type:"SELL", is_limit: leg.type==="Limit", price: leg.trigger_price, amount: leg.qty, stop_order_id: leg.id, pair_id, order_class:"StopOrder", stop_order_type:"STOP_LOSS"|"TAKE_PROFIT", stop_order_status: leg.status, initial_order_price: order.price}`.

### 3.2 Order entry endpoints

Order placement, modification and cancellation endpoints exist in the ThndrX bundle but are intentionally **not
documented or used** by this project (ADR 0006: read-only scope).

---

## 4. Trading journal

### 4.1 `GET /market-service/trading-journals/full-trades` [C]

- Client: `aP`. Note: this goes through **market-service directly, not KrakenD**.
- Evidence: `lazy_5748` near line 675, `lazy_2019` line 909, `lazy_813`, mobile account page:
  ```js
  o.aP.get("/market-service/trading-journals/full-trades",{params:{limit:t,page:e,market:r,symbol_code:n,from_date:a,to_date:l}})
  // market passed as e.toLowerCase(); page starts at 1; limit default 10
  // next page: sum(pages.full_trades.length) < total_count ? page+1 : undefined
  ```
- Query:
  - `market` (lowercase).
  - `page` (1-based).
  - `limit` (default 10).
  - `symbol_code` (optional ticker).
  - `from_date` and `to_date` (optional). These are JS `Date` objects, which axios serializes as **ISO 8601** (`toISOString()`). Presets are 1/3/6 months or 1 year back, start of day. "All time" omits both.
```ts
interface FullTradesResponse { full_trades: FullTrade[]; total_count: number }
interface FullTrade {             // [I] mapping fn `s` in lazy_2019
  asset_id: string;
  reuters_code: string;           // ticker shown
  open_date: string;
  close_date: string;
  avg_entry_price: number;
  close_price: number;            // avg exit price
  volume: number;
  net_pnl: number;
  net_pnl_percentage: number;
  duration_days: number;
}
```

### 4.2 `GET /trading-journals/v1/grouped-sells` (KrakenD) [C]

- Client: `Kc`, so the URL is `https://prod.thndr.app/krakend-thndr-x/trading-journals/v1/grouped-sells`. KrakenD error key: `error_partial_sells`.
- Query: `market`, `symbol_code`, `page` (1-based), `limit` (default 10), `from_date`, `to_date` (ISO).
- Next page while `sell_journals.length === limit`.
- Evidence: `lazy_1021` line 85, `lazy_7241`, `lazy_2019`, mobile account page.
```ts
interface GroupedSellsResponse { sell_journals: SellJournal[]; total_count: number }
interface SellJournal {           // [I] mapping fn `D` in lazy_2019 + mobile account page
  asset_id: string;
  reuters_code: string;
  symbol_code?: string;
  exit_date: string;
  exit_price: number;
  exit_value?: number;
  volume_sold: number;
  avg_entry_price?: number;
  net_pnl: number;
  pnl_percentage: number;
}
```

### 4.3 `GET /trading-journals/v1/trading-metrics` (KrakenD) [C]

- Client: `Kc`. Query: `from_date`, `to_date` (ISO, optional). **No `market` param.** KrakenD error key: `error_trading_metrics`.
- Evidence: `lazy_7193` line 1191, `lazy_4790` line 454.
```ts
interface TradingMetrics {        // [I]
  overall_stats: {
    total_return_egp: number;
    profit_factor: number;
    expectancy_per_trade_egp: number;
    win_rate_percentage: number;
    average_win_egp: number;
    average_loss_egp: number;
    number_of_trades: number;
    average_position_size_egp: number;
    average_duration_days: number;
  };
  stats_per_symbol: Record<string /* asset_id */, {
    total_return_egp: number; total_pnl_percentage: number; win_rate_percentage: number;
    number_of_trades: number; average_win_egp: number; average_loss_egp: number; average_position_size_egp: number;
  }>;
}
```
UI-derived metrics:
- `risk_reward_ratio = average_win_egp / average_loss_egp`
- `expectancy_per_trade_r = expectancy_per_trade_egp / average_loss_egp`

---

## 5. Funding

### 5.1 `GET /funding-service/account-activities` [C]

- Client: `aP`.
- Evidence: `lazy_7241` near line 273, `lazy_642` line 92:
  ```js
  (await o.aP.get("/funding-service/account-activities",{params:{provider:d[e], activity_filter:t, page_size:a, page:r}})).data
  d = { egypt:"EGID", us:"ALPACA", simulator:"THNDR", adsm:"ALPACA_UAE" }
  // next page: results.length > 0 && results.length === page_size ? page+1 : undefined
  ```
- Query:

  | param | value |
  |---|---|
  | `provider` | `EGID` for Egypt |
  | `activity_filter` | optional; no caller in the bundle passes it [?] |
  | `page_size` | default 10 |
  | `page` | 1-based |

```ts
interface AccountActivitiesResponse { results: AccountActivity[]; count?: number /* [?] */ }
interface AccountActivity {       // [I] mapping fn `y`
  ordering_id: string | number;   // row id
  activity_type: "BUY_ORDER" | "SELL_ORDER" | "SUBSCRIBE_ORDER" | "ACCOUNT_DEPOSIT_FUND" | "ACCOUNT_WITHDRAW_FUND" | "BANK_FEES" |
    "REWARD" | "DIVIDEND" | "DIVIDEND_NRA" | "OTHER" | "WALLET_TRANSFER" | "TO_SAVINGS" | "FROM_SAVINGS" | "SUBSCRIPTION_FEES" |
    "GIFT_CARD_OUT" | "GIFT_CARD_IN" | "CASH_DEDUCTION" | "MONTHLY_INCENTIVE" | "COMMISSION_KICKBACK" | "SETTLEMENT_FEES"; // from i18n
  amount: number | string;        // formatted with numeral("0,0.00"), so it may be signed
  created_at: string;
  description: string;            // e.g. "Order Execution", "Bank Fees", "Subscription Fees TRADER 2026-01-01", "Transfer to main account"
  asset_meta?: { symbol?: string };
}
```
Without a token this returns 403 `INVALID_TOKEN` (probe).

---

## 6. Savings ("Clouds"), brief. All calls use KrakenD (`Kc`)

| Method | Path | Body / params | Response (fields read) |
|---|---|---|---|
| GET | `/savings/v1/clouds` | — | `{ amounts_per_type: {}; clouds: Cloud[]; count: number; total_amount: number; total_gain: number }` (live 2026-10-06, account without savings)<br>`Cloud = {id, name, cloud_type, amount, gains, withdrawable_amount}` [I]<br>KrakenD key `error_get_clouds`. Used by `get_savings`. |
| GET | `/savings/v1/clouds-stats` | — | `{ [product: "INSTANT_EGP" \| "MONTHLY_EGP" \| …]: { currently_earning: number; last_updated_at: string /* no time zone */; nominal_yields: { daily, weekly, monthly, quarterly, semi_annually: number } } }` (percent; live 2026-10-06)<br>KrakenD key `error_clouds_stats`. Used by `get_savings`. |
| GET | `/savings/v1/transfer-types/{cloud_id}` | — | `{ transfer_types: [{type: "INSTANT"\|"SCHEDULED"\|"SCHEDULED_CLOUD_FULL_EXIT", fees}] }` [I] |
| POST | `/savings/v1/transfer/calculate-fees` | `{cloud_id, direction:"IN"\|"OUT", transfer_type, amount?}` (no amount for FULL_EXIT) | `{fees, scheduled_at}` [I] |
| POST | `/savings/v1/transfer` | `{cloud_id, direction, transfer_type, is_max_amount?:true \| amount?}` | — |
| GET | `/savings/v1/transfer/{cloud_id}/transactions` | `?page&page_count=10&sort_by&status&direction` (arrays serialized repeated, `indexes:null`) | `{activities:[{id, activity_type:"TRANSFER_IN"\|"TRANSFER_OUT", amount, created_at, scheduled_for, status, currency, fees, transfer_amount, transfer_type}], count}` |
| PATCH | `/savings/v1/transfer-requests/{id}` | `{status:"CANCELLED"}` | — |

Evidence: `lazy_642` lines 708–1564, `lazy_8231` line 25, `chunks_2801` line 2329.

thndr-mcp reads only `clouds` and `clouds-stats`; the transfer endpoints are never called (ADR 0006).

---

## 7. Quick reference (MCP tool mapping)

| Tool idea | Call |
|---|---|
| get_balance / get_portfolio | `GET https://prod.thndr.app/market-service/accounts/wallet-and-portfolio?market=egypt` |
| get_position | `GET https://prod.thndr.app/krakend-thndr-x/portfolio/v1/position/{asset_id}?market=egypt` |
| get_sellable_qty | `GET .../market-service/accounts/positions/blocked-quantities/{asset_id}?market=egypt` |
| list_orders | `GET .../market-service/v3/orders?market=egypt&status=PENDING&limit=20&sort_order=DESC&skip_funds=true[&cursor=][&asset_id=]` |
| market_status | `GET .../market-service/markets/status?market=egypt&market_exchange=NOPL`, `GET .../market-service/markets/hours?market=egypt` |
| returns | `GET .../market-service/realized-returns?market=egypt`, `GET .../market-service/realized-returns/chart/{1M\|6M\|1Y\|2Y}?market=egypt` |
| journal | `GET .../market-service/trading-journals/full-trades`, `GET .../krakend-thndr-x/trading-journals/v1/grouped-sells`, `GET .../krakend-thndr-x/trading-journals/v1/trading-metrics` |
| activity | `GET .../funding-service/account-activities?provider=EGID&page=1&page_size=10` |
| plan / free orders | `GET .../payment-service/v2/subscriptions`, `GET .../market-service/waived-commissions/used-count?market=egypt` |
