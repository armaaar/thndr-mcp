> Produced with the `sync-thndr-mobile-api` skill by static analysis of the Thndr Android app 12.56.0 (2026-10-06).
> Findings are `[C]` (seen in the code) or `[I]` (inferred) until a read-only live check marks them `[P]`. Module and
> offset references (M####, S:/D:) point into the decompiled output in `.cache/thndr-mobile/`, which is not committed.

# Thndr Android app (12.56.0) — API usage per market (Egypt / US / UAE)

Source: `index.android.bundle` from `com.axismarkets.thndr` 12.56.0 (APKPure xapk), Hermes bytecode **v96**
(101,597 strings, 71,905 functions, 8,590 Metro modules). Nothing was executed and no live API was called.

Legend: **[C]** confirmed from code (call site / literal in the decompiled bundle); **[I]** inferred (naming, UI
usage, or type guessed).

Evidence references:
- `Mxxxx` = Metro module id (from `__d(factory, id, deps)`), with the exported names.
- `S:nnnn` = line in `simplified.js` (folded pseudo-JS); `D:nnnn` = line in `decompiled.js` (raw hermes-dec).
- Function names come from Hermes' preserved function names ("Original name").

## Contents
0. Executive summary + per-market cheat sheet · 1. Markets, eligibility, providers, currencies, status/hours · 2. Market data · 3. Account · 4. Transport + new read-only features (B) · 5. Cross-check of thndr-mcp endpoints (A) · 6. Write operations (documented, not implemented) · 7. Open questions

## How this was produced (reproducible)

With the committed `sync-thndr-mobile-api` skill (scripts in `.claude/skills/sync-thndr-mobile-api/scripts/`); outputs
stay in the git-ignored `.cache/thndr-mobile/<version>/decompiled/`. Python runs with `-I`; nothing from the download
is executed.

| step | command | output |
|---|---|---|
| download and unpack | `fetch-apk.sh` (apkeep 1.1.0, sha256-pinned) | split APKs and `base/assets/index.android.bundle` |
| decompile | `decompile.sh` (hermes-dec pinned at `a0f18f9`, supports bytecode v96) | `decompiled.js` (113 MB, 2.97 M lines) |
| string table | `dump-strings.py <bundle> strings.tsv` (run with the skill's venv) | `index<TAB>string`, 101,597 strings |
| readable pseudo-JS per module | `simplify.py decompiled.js <dir>` | `simplified.js` (1.16 M lines), `modules.tsv` |
| HTTP call sites | `list-calls.py simplified.js > calls.tsv` | 350 call sites |

References in this document: `M####` = Metro module id, `S:` = line in `simplified.js`, `D:` = line in
`decompiled.js`. `simplify.py` caveats: a call result may be printed inline more than once; `{}.x` means an object
literal whose keys were not tracked (check `decompiled.js` at the module's `D:` line).


---

## Executive summary

**Hosts and auth.** `thndrApi` = `https://prod.thndr.app/` (BuildConfig `BASE_API`; `https://prod-eks.thndr.app/` when the
Unleash flag `mobile_eks_cluster_enabled` is on). `apiGateway` = `https://prod.thndr.app/krakend-thndr-app`. This is a
**second KrakenD gateway**, different from the web's `krakend-thndr-x`, with its own paths (`/securities/v1|v2`,
`/explore/v1`, `/asset/v1`, `/charts/v1|v2`, `/wallet/v1`, `/portfolio/v1|v2`, `/orders/v1`, `lists/v1`, `home/v1`,
`clouds/v1`, `news/v1`, `dividends/v1`, `price-alerts/v1`). Every client sends the same `Authorization: Bearer <APP_TOKEN>`.
The token comes from `POST auth-service/v2/tokens/full-access`, the same endpoint the web uses, so it is the same JWT
family [I]. Other headers: `X-DUID`, `sessionId`, `X-Language`, `x-correlation-id`. KrakenD errors arrive as
`error_<section>` keys inside a 200 body, as on the web.

**Market codes.** `egypt`, `us`, `abudhabi` (UAE: account, wallet, orders, status and alerts), `adsm` (UAE: the
instrument `market` and feed `market_id`), `simulator`. `adsm` is rejected as a selected market and is rewritten to
`abudhabi` before account calls. The opposite happens for Thndr-lists and investment products: there the app sends
`adsm` when the user is on `abudhabi`. The index lists also include `tdwl` (Saudi Tadawul), for display only.

### Per-market cheat sheet

| Need | Egypt (`egypt`) | US (`us`) | UAE (`abudhabi` / `adsm`) |
|---|---|---|---|
| Which markets the user has | `GET compliance-service/eligibilities/v2/visible-markets` → `{default_market, markets[{name,is_restricted,restriction_reason}]}`, plus `compliance-service/eligibilities` (product `EGX` / `Egyptian Mutual Funds`) | same list; product `Alpaca`; US account data needs `alpaca_id` (from `POST auth-service/v2/users/info`) | same list; product `ADSM` (`NO_ADX_CODE`, `NO_ADX_IBAN`, `PENDING_AE_TC`, …); compliance form `adx_investor_number`, `adx_nim_code` |
| Search | `assets-service/assets/search?…&market=egypt` or gateway `explore/v1/securities/search` (ids → `securities/v2/price` + `asset/v1/metadata`) | same, `market=us` | same, selected market [I: `abudhabi`; instruments come back as `adsm`] |
| Details / fundamentals | `assets-service/assets/{id}` + marketwatch row stats | `assets-service/assets/{id}` (`market_cap, pe, div_yield_prc, eps, avg_value, value`); Morningstar `assets-service/assets/{id}/analytics` | `assets-service/assets/{id}` (same fields as US) |
| Quotes for many | `assets-service/assets/marketwatch` (no params, Egypt only) or gateway `securities/v2/price?asset_id=…` | gateway `securities/v2/price` only (delayed; no RTDB) | gateway `securities/v2/price`; RTDB realtime behind a flag |
| Realtime | Firebase RTDB `marketFeed/{id}/…` / `assetPrice/{id}/price/last/value` (subscribers) | none | RTDB (flag `mobile_securities_enable_adx_real_time_prices`; otherwise indices only) |
| Line chart | gateway `charts/v1|v2/line-chart/{id}` (flag) or `assets-service/charts?…&market=egypt` | `assets-service/charts?asset_ids&option&market=us` | `assets-service/charts?…&market=adsm` |
| Candles | gateway `charts/v1/candlesticks-chart/{id}`, TradingView `charts/v1/ohlc-candlesticks/{id}`, legacy `assets-service/charts/candlesticks` | `assets-service/charts/candlesticks?asset_id&chart_option&market=us` (+ TradingView endpoint [I]) | not offered |
| Market status | `market-service/markets/status?market=egypt&market_exchange=<feed.market_id>` | `…market=us&market_exchange=NOPL` (extended hours) | `…market=abudhabi&market_exchange=adsm` |
| Depth / trades | REST depth (2 s poll) + `market-depth/{v2|v3}/trades-book/{id}` | none | depth via RTDB `abudhabiPriceDepth/{id}` (needs a subscription); no trades book |
| News | gateway `explore/v1/news/articles` | gateway `news/v1/market?markets=us&asset_id=…` | gateway `explore/v1/news/articles` |
| Movers / indices | `assets-service/assets/rank?type=GAINERS|LOSERS&duration=1D…`, gateway `explore/v1/assets/trending`, `explore/v1/default-market-indicators?market=egypt&market=us&market=tdwl&market=abudhabi` | same, `market=us` | same, `market=abudhabi` |
| Wallet / portfolio | `market-service/accounts/wallet-and-portfolio?market=egypt`, gateway `wallet/v1/summary`, `portfolio/v1/info`, `home/v1/holdings` (+ clouds) | same, `market=us` (needs `alpaca_id`) | same, `market=abudhabi` |
| Positions | `market-service/accounts/positions[/{id}]?market=`, gateway `portfolio/v1/position/{id}` | same | same, `abudhabi` |
| Orders | `market-service/v3/orders?market=egypt` (cursor) + `market-service/orders/{id}?market=` | same | same, `abudhabi` |
| Activities | `funding-service/account-activities?provider=EGID` or gateway `wallet/v1/activities?provider=EGID` | `provider=ALPACA` (wallet requests use `ALPACA_UAE`) | `provider=ADX_UAE` (`activities-service` uses `market=uae`) |
| Returns | `market-service/realized-returns[/chart/{1d..all}]` or gateway `v1/portfolio-analytics/*` | same | not offered in the UI |
| Trading journal | not in the app (web only) | — | — |
| Watchlists | gateway `asset/v1/watchlist?market=`, `lists/v1/user-watchlists?market=` | same | same [I: market value unconfirmed] |
| Price alerts | `price-alerts-service/price-alerts` (flag) or legacy `assets-service/price-alerts` | same | behind a flag; `market=abudhabi` |
| Savings (Clouds) | yes | no | no |
| Currency | EGP | USD | AED (strings; the app has no numeric currency codes) |
| Time zone | Africa/Cairo | (America/New_York, server side [I]) | Asia/Dubai |

### Answers to the questions

1. **Market switching** is decided server-side by `visible-markets`. Eligibility per product comes from
   `compliance-service/eligibilities`. There are older client fallbacks (nationality/residence matrix; flag
   `can_view_all_markets`) and many per-market Unleash flags (§1.3; all 267 names in `out/flags.txt`). No Statsig.
2. **Market data**: §2. Key new facts:
   - `securities/v2/price` is the bulk quote source for every market.
   - US and UAE have no marketwatch, and the US has no realtime feed.
   - UAE depth comes over RTDB.
   - US news has its own endpoint.
   - US fundamentals are fields on the asset-details payload, plus the Morningstar analytics endpoint.
3. **Account**: §3. UAE always uses `abudhabi`. Providers are EGID / ALPACA / ADX_UAE (`ALPACA_UAE` only for US wallet
   requests and the legacy `uae` statements). The app has no trading journal; Returns are not shown for UAE; Clouds
   are Egypt only.
4. **Currencies and time zones**: §1.5 and §1.6. EGP / USD / AED / THNDR (simulator) are strings only. Sessions come from
   `market-service/markets/hours`; nothing is hard-coded.
5. **Read-only extras the web lacks**: §4 B, in priority order:
   - US analyst ratings (Morningstar)
   - dividends history and totals, including dividends the user received
   - global indices (incl. Tadawul)
   - gainers/losers/trending
   - fund fact sheets and NAV
   - collections and the tag → instruments listing
   - legacy technical/financial/consensus analysis
   - statements
   - IPO fields and real estate
   - gold

   Not found in the app: earnings, ETF holdings, sector pulse, foreign/local flows, a heatmap endpoint, macro data,
   corporate actions.

---

## 1. Markets: which ones a user has, codes, providers, currencies, hours

Evidence refers to `out/simplified.js` line numbers (`S:<line>`) and Metro module ids (`M<id>`); raw code is in
`out/decompiled.js` at the line printed in each module header. **[C]** confirmed from code, **[I]** inferred.

### 1.1 Market codes (several copies of the enum exist) [C]

| Constant | Value | Where it is used |
|---|---|---|
| `MarketName.EGYPT` | `egypt` | everywhere (EGX) |
| `MarketName.US` | `us` | everywhere (Alpaca) |
| `MarketName.ADX` | `abudhabi` | **the user-facing / account market** for the UAE: settings `selectedMarket`, wallet, positions, orders, market status `market=` |
| `MarketName.ADSM` | `adsm` | **the instrument market** for UAE assets: `asset.market === 'adsm'` (M3820 S:597550, M5598, M5613…), asset feed queries (`useMarketSwitch.setMarket` invalidates `ASSETS_QUERY_KEYS.feed` with `ADSM` when ADX is selected, M5600 S:850389-850395), `MARKET_ID.ADSM = 'adsm'` (feed `market_id`, S:350627) |
| `MarketName.SIMULATOR` | `simulator` | paper trading |
| `MarketName.UAE` | `deprecated_uae` (M1850/M1859/M2742) or `uae` (M2772) | legacy; `Market = {US:'us', EGYPT:'egypt', UAE:'uae'}` (M534) is a *region* code used by `MARKET_NAME_TO_MARKET_MAP` |

Canonical modules: `M1859` (S:349829, re-exported by `M1858`, the one most code imports), `M1850` (S:349114, has
`AVAILABLE_*`), `M2742` (portfolio constants, S:459717), `M534` (wallet, S:118357), `M3575` (orders, S:552347).

Normalisation rules [C]:
- `getFeatureByMarket`/`useSecurityLandingMarketFeature` (M3562 S:551628): `adsm → abudhabi` before lookup.
- `useStockRefresh` (M5731 S:864210) and `useMarketStatus` (M5676 S:859807): `adsm → abudhabi`, `null → egypt`.
- `toV3HoldingsMarket` (M2769 S:461699): `egypt→egypt, us→us, abudhabi→abudhabi, simulator→simulator`.
- `getAssetMarket(selectedMarket, assetMarket)` (M3933/M1865): in simulator always `simulator`; otherwise `asset.market ?? selectedMarket`.

**Rule of thumb for an MCP client [C+I]:** account/portfolio/order/status calls use `market=abudhabi`; instrument
data carries `market: "adsm"` and feed `market_id: "adsm"` (asset-service calls such as search/marketwatch for the UAE are
expected to use `market=adsm`, as in the web bundle — check fork #2's section for the exact call sites).

### 1.2 Market → provider (custodian) maps (M534 S:118381-118404, M2772 S:461877, M5845 S:873559) [C]

| market | `MARKET_PROVIDER_MAP` (M534) | `MARKET_PROVIDER_NAME_MAP` | `MARKET_PROVIDER_FUNDING_REQUESTS_MAP` | `ACTIVITIES_MARKET_FUNDING_PROVIDER` (M5845) | `MARKET_NAME_TO_MARKET_MAP` |
|---|---|---|---|---|---|
| `egypt` | `EGID` | `EGID` | `EGID` | `EGID` | `egypt` |
| `us` | `ALPACA` | `ALPACA` | **`ALPACA_UAE`** | `ALPACA` | `us` |
| `abudhabi` | `ADX_UAE` | `ADX_UAE` | `ADX_UAE` | `ADX_UAE` | `uae` |
| `simulator` | `THNDR` | `EGID` | `EGID` | — | `egypt` |

`ProviderName/FundingProvider = {THNDR, EGID, ALPACA, ALPACA_UAE, ADX_UAE}`; reverse `PROVIDER_MARKET_MAP`:
`THNDR→simulator, EGID→egypt, ALPACA→us, ALPACA_UAE→us, ADX_UAE→abudhabi`. M2772's copy maps the legacy `uae`
market to `ALPACA_UAE` (UAE residents' US account) [C]; hence `ALPACA_UAE` = a US (Alpaca) account opened under the UAE
entity [I]. Use `provider=ADX_UAE` for UAE account activities / statements, `ALPACA` for US activities.

Compliance product names (eligibility `product_name`, M1852 S:349289) [C]:
`ProductName = { EGX:'EGX', ALPACA:'Alpaca', EGYPTIAN_MUTUAL_FUNDS:'Egyptian Mutual Funds', ADSM:'ADSM' }`.

### 1.3 How the app decides which markets the user has [C unless noted]

Three layers, newest first:

**(a) Server list — `GET https://prod.thndr.app/compliance-service/eligibilities/v2/visible-markets`** (client `thndrApi`,
Bearer token; `useVisibleMarkets`, M1954 S:358220; query key `COMPLIANCE_QUERY_KEYS.visibleMarkets`, `staleTime: Infinity`).
No params. Response fields read:
```ts
interface VisibleMarkets {
  default_market: "egypt" | "us" | "abudhabi" | "simulator";
  markets: Array<{
    name: "egypt" | "us" | "abudhabi" | "simulator";   // looked up in MARKET_DATA_V2[name] for label/flag (M5601)
    is_restricted: boolean;                             // restricted markets are dropped from the names list (M1931 S:357106)
    restriction_reason?: "NOT_THNDR_FORTUNE" | "USER_UNDER_ELIGIBLE_AGE"; // MarketRestrictionReason (M1852); drives a modal (M5895 S:877133-877154)
  }>;
}
```
On error the hook falls back to `{ default_market: <settings.v2.selectedMarket>, markets: [selected, "simulator"] }`
(S:358246-358271). `useMarketSwitch` (M5600 S:850375) exposes `marketsList` built from `markets` (+ `MARKET_DATA_V2`
labels `settings.egyAccount|usAccount|uaeAccount|simulatorAccount`). The market switcher (`useMarketSwitcher`, M5895)
refuses a market whose entry `is_restricted`, showing the `restriction_reason` modal.

**(b) Selected-market initialisation — `useInitializeSelectedMarket`** (M3932 S:609432-609660). Inputs:
`{defaultMarket, markets, country, nationality}` (from visible-markets + compliance form). Picks the stored
`settings.v2.selectedMarket` if it is in `markets`, else `defaultMarket`, else `markets[0]`. Older path (still compiled):
`getAvailableMarkets({country, nationality, registeredForUS, registeredForEgypt})` (M3933 S:609687):
- `registeredForEgypt` = eligibility `registration_status` of `EGX` or `Egyptian Mutual Funds` is `REGISTERED`;
  `registeredForUS` = `Alpaca` is `REGISTERED` (S:609542-609571).
- both → `[us, egypt, (abudhabi)] + simulator`; only EG → `[egypt, simulator]`; only US → `[us, simulator]`;
- neither but nationality+country known → `getUserKycFlow(nationality, country).markets + simulator` (M1857), keyed
  `"<nationality>|<residence>"` with `EGY/SAU/ARE/ELSE`:
  `EGY|EGY→[egypt]`, `EGY|SAU→[us,egypt]`, `EGY|ARE→[us,egypt,abudhabi]`, `EGY|ELSE→[us,egypt]`,
  `SAU|ARE`, `ARE|ARE`, `ELSE|ARE → [us,abudhabi]`, every other combination → `[us]` (default object).
- nothing known → `[egypt, simulator, us, …]` with Egypt as default.

**(c) Legacy client gate** (settings store, M6552 S:961975): `initializeAvailableMarkets` sets
`settings.availableMarkets = isEnabled('can_view_all_markets') ? AVAILABLE_ALL : AVAILABLE_EGYPT`
(default confirmed in decompiled.js; the simplifier drops it). `AVAILABLE_ALL = [us, egypt, abudhabi]` in M1850
(`[us, egypt]` in the older M1859). `setAccountCountry` (M6434 S:936283): if unleash `us_market` is on and no market is
selected, `MAP_COUNTRY_DEFAULT_MARKET[country]` (`EG/EGY→egypt`, `US/USA→us`, M1849) is selected.

Persistence: selected market is saved in insecure storage `settings.v2` (`{selectedMarket, simulatorEnabled, …}`) and
mirrored to Firebase RTDB `settings/{firebaseUid}/selectedMarket` (`setSelectedMarketCache` / `getCachedSelectedMarket`,
M6552 S:962032-962069; not for simulator). Derived `settings.market` = `simulator` when simulator is enabled, else
`selectedMarket` (M6551 S:961520-961537).

**Eligibilities — `GET https://prod.thndr.app/compliance-service/eligibilities`** (M5359 `getUserEligibilities`
S:826702; registry `compliance.getEligibilityProducts`). Response `{ eligibilities: Record<string|number, Eligibility> }`
(code does `Object.values(res.eligibilities)`, M6433 S:935925-935935):
```ts
interface Eligibility {
  product_name: "EGX" | "Alpaca" | "Egyptian Mutual Funds" | "ADSM";
  eligibility_status: "ELIGIBLE" | "ACCOUNT_FORM_NOT_ACCEPTED" | "NOT_EVALUATED" | "NOT_REGISTERED" | "NOT_SIGNED"
    | "NOT_SIGNED_NOT_BOOKED" | "NOT_SIGNED_BOOKED" | "UNDERAGE" | "NO_EGX_CODE" | "NO_THNDR_CODE" | "NO_EGX_CODE_BLOCKED"
    | "PENDING_W8BEN" | "SUSPENDED" | "PENDING_US_TC" | "PENDING_AML" | "REJECTED_AML" | "PENDING_AE_TC"
    | "NOT_ELIGIBLE" | "NO_ADX_IBAN" | "NO_ADX_CODE";                       // M1852 S:349288
  registration_status: "NOT_ATTEMPTED" | "NOT_QUALIFIED" | "REGISTERED" | "PENDING" | "FAILED" | "REJECTED" | "DISABLED"
    | "NOT_SIGNED" | "NOT_SIGNED_NOT_BOOKED" | "NOT_SIGNED_BOOKED" | "NO_EGX_CODE" | "NO_THNDR_CODE" | "NO_EGX_CODE_BLOCKED"; // M5348
}
```
Stored as `account.eligibilityStates[product_name]` / `account.eligibilityRegistrationStates[product_name]`.
Related read-only calls: `GET compliance-service/funding-eligibilities` (M1945), `GET compliance-service/suspension-statuses`
(M1951; fields `buying_securities_suspended`, `selling_securities_suspended`), `GET compliance-service/blocked-countries`
(`blocked_countries`/`blocked_nationalities` keyed by product), `GET compliance-service/account-forms` (compliance form:
`status`, `country`, `nationality`, `user_id`, `adx_investor_number`, `adx_nim_code`), `GET compliance-service/eligibilities/not-coded/count` (M2481).
ADX trading readiness (`handleADXTrading`, M5357 S:826380+) = ADSM `eligibility_status === ELIGIBLE` && form ACCEPTED &&
not blocked && not suspended && `adx_investor_number`/`adx_nim_code` set; user tags `adx_existing_code`/`adx_invalid_iban`
block registration (`ADX_REGISTRATION_BLOCKED_TAGS`, M3563).

**User profile fields** [C]: `authentication.userInfo.data` (from `POST auth-service/v2/users/info` with
`{credentials:{firebase_token}}`, M6458) defaults `{email, has_active_recovery, phone_number, type, uid, username, has_pin,
has_password, has_security_question, alpaca_id, name, signed_uid, first_name, last_name}` (M3662 S:562483).
**`alpaca_id` gates US account data**: `useWalletAndPortfolio` (M2914 S:473909) and `usePortfolioPosition` (M3639 S:558457)
disable their queries for `market === 'us'` when `alpaca_id` is empty ("…disabled for us market as user has no alpacaId yet").
`GET krakend-thndr-app/v1/users/me` (M6866) is only read for `email`, `phone_number`, `username` (Account screen) — not market data.
Profile multipart update sends `us_market_eligible` / `uae_market_eligible` (M6553 S:962627-962675) [C, write].

**Unleash flags relevant to markets** [C names; effects C where stated]:
`can_view_all_markets` (legacy available list), `us_market` (default US for US-country users), `mobile_access_UAE_enablement`
(UAE switching; also sets `global-market-store.isUAESelected = selectedMarket === 'us'` when on, M3932 S:609468),
`mobile_visible_markets_initialization_fix`, `mobile_account_show_skip_market_switch_checkbox`, `mobile_market_new_config`
(orders/securities market config), `mobile_eks_cluster_enabled` (base URL → `https://prod-eks.thndr.app/`),
`mobile_securities_enable_adx_real_time_prices`, `mobile_securities_adx_price_alerts`,
`mobile_securities_pre_open_market_status_in_egypt_market`, `mobile_securities_eg_use_price_alerts_service`,
`mobile_securities_use_price_alerts_service`, `app_show_candlestick_chart(_US)`, `mobile_portfolio_us_returns`,
`mobile_portfolio_egypt_returns`, `mobile_portfolio_maintenance_{us,adx}`, `mobile_wallet_maintenance_{egypt,us,adx}`,
`mobile_orders_adx_*`, `mobile_wallet_{us,adx}_*` (top-up methods), `us_funded_account`, `app_public_holiday`,
`app_adx_public_holiday`. Full list of 267 flag names: `out/flags.txt`. No Statsig; PostHog (`eu.i.posthog.com`) is analytics only [I].

### 1.4 Per-market feature availability (`SECURITY_LANDING_FEATURES_MAP`, M3563 S:551715) [C]

| Feature | egypt | us | abudhabi | simulator |
|---|---|---|---|---|
| PriceAlert | yes | yes | flag `mobile_securities_adx_price_alerts` | no |
| ShouldUsePriceAlertsService | flag `…eg_use_price_alerts_service` | flag `…use_price_alerts_service` | yes | yes |
| LiveStatistics | yes | — | — | yes |
| RealTimeCharts | yes | — | — | yes |
| Candlesticks | yes | yes | — | yes |
| Subscriptions (paid tiers) | yes | — | — | yes |
| MarketStatus | `market_exchange = feed.market_id`, pre-open per flag | `market_exchange = NOPL`, **extended hours shown** | `market_exchange = adsm` | — |
| RealTimePrice | always | — (not realtime) [I: delayed] | flag `mobile_securities_enable_adx_real_time_prices`, else only INDEX assets | — |
| DigitalSignature, BlockTrading, InQueuePrompt | yes | — | — | — |

### 1.5 Currencies [C]

`MARKET_CURRENCY_MAP` (M534 S:118364, M1859 S:349837): `simulator→THNDR`, `egypt→EGP`, `us→USD`, `abudhabi→AED`,
`adsm→AED`, `deprecated_uae→USD`. Currency enums are strings only (`{THNDR, EGP, USD, AED}`, `{EGP, USD, AED, SAR, points}`
labels); **no numeric currency code mapping exists in the mobile app** (searched; the web's `0/1/2` map is absent) — treat
numeric `currency` from asset payloads with the web map (`0 points, 1 egp, 2 usd`) and expect `AED` as a string [I].
Currency sort order for grouping securities: `['points','EGP','USD','AED','THN']` (M8258).

### 1.6 Market status and hours [C]

- **`GET https://prod.thndr.app/market-service/markets/status?market=<m>&market_exchange=<x>`** (`getMarketStatus`, M5677
  S:859976; decompiled.js 2070780-2070820 — the simplified params are wrong there). `market` = asset market normalised
  (`adsm→abudhabi`, default `egypt`); `market_exchange`: Egypt → the asset's `feed.market_id` (`NOPL`, `OOTC`, `SME`,
  `FNDS`, `INDX`), **US → always `NOPL`**, UAE → `adsm` (via `SECURITY_LANDING_FEATURES_MAP.MarketStatus[m].getMarketId`).
  Response read (`useMarketStatusData`): `is_active`, `market_status` (`OPEN | CLOSED | PRE_MARKET | POST_MARKET | UNKNOWN`,
  `MarketStatusState` M3564), `next_open`, `next_close`. Stale 60–120 s. Registry duplicate: `market.getMarketStatus`
  with `{market}` only (M6577).
- **`GET https://prod.thndr.app/market-service/markets/hours?market=<egypt|us|abudhabi>`** (`getMarketHours`, M1872 S:350240).
  Response `{session_open, session_close}` (ISO datetimes, parsed with `new Date`). Used for the open/closed bottom sheet
  (M5676) and to back-fill 1D Egypt charts (M5619, M5461).
- `GET market-service/markets/active-hours/{market}` (M1864) → `{next_session_open, next_session_close,
  is_current_session_active}`; the hook `useActiveMarketHours` exists but has no caller (dead code).
- Registry also lists `GET market-service/markets/fees` (`market.getFees`, M4125) [C, unused by these screens].
- **No hard-coded trading sessions/holidays in the mobile app** (unlike the web's TradingView config): sessions come from
  `markets/hours`; holidays only appear as unleash flags (`app_public_holiday`, `app_adx_public_holiday`) for phone support.
- Timezones [C]: `Africa/Cairo` (Egypt; dates formatted in Cairo time, M4418 S:697659), `Asia/Dubai` (ADX); weekends EG
  Fri–Sat, ADX Sat–Sun (support-hours config M5936 S:880681 — support hours, not trading hours: EG 08:30–15:00, ADX
  09:30–15:30). US: no timezone constant; extended hours exist (`shouldDisplayExtendedHours: true`, Alpaca
  `ExtHrsRisk.pdf`, flag `mobile_orders_place_outside_market_hours`) [I: America/New_York server-side].

### 1.7 Second request mechanism — service registry (important for other sections) [C]

Besides direct axios calls, code uses `request({serviceName, functionName, urlExtension, queryParams, payload})` (M6475)
resolved by the registry `M4125` → `https://{BASE_API}{service}{path}{/urlExtension}{pathPostfix}` (dumped to
`out/service-registry-M4125.txt`). Used entries include `assets.getAssetFinancial` (`/assets-service/analysis/financial`),
`assets.getAssetConsensus` (`/analysis/consensus`), `assets.getAssetTechnical` (`/analysis/technical`),
`assets.getAnalytics`, `assets.getAnalyticsReport`, `assets.getRecommendations`, `securities.getTrending`
(`/assets-service/assets/trending`), `securities.getTopPerformers` (`/assets-service/assets/top_performers`),
`feedV2.getNews` (`/api/post/news`), `investor.getPortfolio` (`/market-service/accounts/portfolio`),
`portfolio.getAccountSummary` (`/market-service/accounts/summary`), `order.getOrderHistory`, `market.getMarketStatus/getMarketHours/getFees`.
These do not appear in `out/calls.tsv` (which only lists direct client calls).

---

## 2. Market data per market

Legend: **[C]** confirmed from code (module/function + simplified.js line), **[I]** inferred.
Clients: `thndrApi` = `https://prod.thndr.app/` (prod-eks if flag `mobile_eks_cluster_enabled`), `apiGateway` = `https://prod.thndr.app/krakend-thndr-app` (KrakenD, aggregated `{<section>: …, error_<section>: {...}}` 200 bodies, unwrapped with `toResult(data, error)` M4300). Same Bearer token, plus `X-DUID`, `X-Language`, `x-correlation-id`.
`Cache-Control: no-store` is added when a hook passes `disableGWCache` (M5515) [C].

### 2.0 Market codes as used by market-data code [C]
`MarketName` (M1859, simplified.js:349829): `simulator, egypt, us, abudhabi (ADX), adsm, deprecated_uae`.
- An **instrument's** `market` field is `egypt` | `us` | `adsm` (UAE securities). The UI resolves `adsm → abudhabi` before looking up per-market feature config (`useSecurityLandingMarketFeature`, M3562).
- Indicator lists send `abudhabi` where the asset market is `adsm` (`toMarketPayload`, M8014 – note simplified.js drops this default; confirmed in decompiled.js:2828578).
- `MARKET_ID` (M1876): `OOTC, NOPL, FNDS, SME, INDX, ADSM='adsm'`. Market-status `market_exchange` per market: egypt → the asset's own `feed.market_id` (identity `getMarketId(a0) => a0`), **us → `NOPL`**, abudhabi → `adsm` (`getMarketId` in SECURITY_LANDING_FEATURES_MAP, M3563; re-verified in decompiled.js:1236652-1236700, caller decompiled.js:2070171) [C].
- `StockStatus` `{ACTIVE:'A', SUSPENDED:'S'}`; `AssetClasses` `STOCK|ETF|INDEX|FUND`; `ProductName` (feed provider) `EGX|Alpaca|Egyptian Mutual Funds` [C].

#### Per-market feature matrix (`SECURITY_LANDING_FEATURES_MAP`, M3563 simplified.js:~1236360) [C]
| Feature | egypt | us | abudhabi (adsm) |
|---|---|---|---|
| PriceAlert | yes | yes | flag `mobile_securities_adx_price_alerts` |
| LiveStatistics (marketwatch live stats) | yes | – | – |
| RealTimeCharts (1D intraday refresh) | yes | – | – |
| Candlesticks | yes | yes | – |
| Subscriptions (IPO/rights) / DigitalSignature / BlockTrading / InQueuePrompt | yes | – | – |
| MarketStatus | yes (`market_exchange` = asset `feed.market_id`, pre-open via flag `mobile_securities_pre_open_market_status_in_egypt_market`) | yes (`market_exchange=NOPL`), **extended hours shown** | yes (`market_exchange=adsm`) |
| RealTimePrice (Firebase RTDB) | yes | – | flag `mobile_securities_enable_adx_real_time_prices`, else INDEX only |
| ShouldUsePriceAlertsService | flag `mobile_securities_eg_use_price_alerts_service` | flag `mobile_securities_use_price_alerts_service` | yes |
Simulator mirrors Egypt for most features.

### 2.1 Instrument search
Two implementations; the "V3" Explore (user toggle `__THNDR_USE_V3__`, `useV3Store().shouldUseV3`, M3874/M7989) uses the new one.

**Legacy** — `GET thndrApi /assets-service/assets/search?query={q}&page=1&market={market}&include_feed=true&feed_detail=true` (M1906 `searchAssets`, simplified.js:355261) [C]. Response `{assets:[…]}`; app keeps the first 10. Market = selected market (`egypt|us|…`).

**New** — `GET apiGateway /explore/v1/securities/search?query&market&page&page_count=20[&asset_class]` (M8037 `searchSecurities`, simplified.js:1119224; caller `getQueryOptions` in M8032) [C].
- Response `{count, results:[assetId…]}` — results are **asset ids only**; pagination: next page while `Σresults.length < count` [C].
- The UI then hydrates ids with **`/securities/v2/price`** and **`/asset/v1/metadata`** (2.3). Metadata fields read: `symbol, name, currency, logo, asset_class` [C, M8032 raw props].
- `market` = `useGetSelectedMarket().selectedMarket`.
People search (`/explore/v1/people/search?q&page&page_count`) also exists (M8040).

### 2.2 Instrument details
- `GET thndrApi /assets-service/assets/{id}?include_feed=true&feed_detail=true&include_yearly_return={bool}` (M1918 `getSecurityDetail`, simplified.js:356078) — **used for every market** (US/UAE too) [C]. Fields read on the landing (M5588 `useStockValue`, M5683 `useStatistics`): `id, symbol, name, logo, currency, market, asset_class, is_3dp, price, previous_close, price_field, is_right, is_ipo, stats.symbol_state, feed.*`, and **US/UAE fundamentals** `market_cap, pe, div_yield_prc, eps, avg_value, value (today value), open` (merged `{...feed, ...details}`) [C].
- `GET thndrApi /assets-service/assets/{id}/metadata` (M1903 `getAssetMetaData`, simplified.js:354994): `market, asset_class, is_ipo, is_realtime_price_enabled` read [C]. `asset.market` from here drives chart routing.
- `GET apiGateway /asset/v1/metadata?asset_id=A&asset_id=B…` (bulk, sorted ids, max 50/request, 5 ms batching, min bulk 4 — M5519/M5517) [C]. Response `{results:[{id, symbol, name, currency, logo, asset_class, extra_links[{issued_at,…}], property_metadata?{status, subscription_start_date, lockup_release_date, end_date}}]}` [C fields id/extra_links/property_metadata; I others].
- `GET apiGateway /securities/v1/details?asset_id=…&include_feed&feed_detail&market&asset_class` (M7817 `getSecurityDetails`) — bulk details, used by real-estate funds screens; error key `error_fetch_assets_bulk_details` [C].
- Peers: `GET thndrApi /assets-service/assets/{id}/recommendations?include_feed=true&feed_detail=true&market={m}&recommendations_number={n}` (M1916) [C].

#### Statistics shown per market (M5729 `statisticsMarketMap`) [C]
- egypt: open, high, low, previous_close, total_volume, avg_90_day, total_value, high_52_week, low_52_week, calculated_market_cap (= marketwatch `listed_shares × price`), dividend_yield_perc, eps, pe_ratio — from **marketwatch row** (LiveStatistics) + details.
- us: marketCap, priceEarning, dividendYield, earningShare, avgValue, todayValue — from **assets-service details** (`market_cap, pe, div_yield_prc, eps, avg_value, value`).
- adsm: marketCap, priceEarning, dividendYield, earningShare, openPrice, todayValue (same source).
Provider label per market: `…provider.title.us|egypt|adx` (i18n keys only). No separate US fundamentals endpoint was found besides these fields and the legacy analysis endpoints (2.9).

### 2.3 Live / bulk quotes
**Bulk price (all markets)** — `GET apiGateway /securities/v2/price?asset_id=A&asset_id=B…` (M5514 `getSecurityPrice`, `SECURITY_PRICE_ENDPOINT='securities/v2/price'`) [C]. KrakenD response:
```
{ price: {results:[{asset_id, price:{last:{value}|null, ask:{value}|null, bid:{value}|null,
                                      nav:{value, daily_change, annualized_return}|null, rate:{value}|null}}]},
  day_snapshot: {results:[{asset_id, day_snapshot:{last:{previous_close}, ask:{previous_close}, bid:{previous_close}, rate:{previous_close}}}]},
  error_asset_price_v2?, error_asset_day_snapshot_v2? }
```
Mapped to `priceType: transactional (last) | quote (bid/ask) | nav (funds) | rate (FX)`, change = value − previous_close (M5516 `mapPriceToEntity`) [C]. Used by Explore search, trending, market indicators, watchlists (prices store M5510). This is the **US/UAE equivalent of marketwatch** (no per-market list endpoint; you need ids first).

**Egypt marketwatch** — `GET thndrApi /assets-service/assets/marketwatch` **without a market param** (M1904 `useEGMarketWatchAssets`, decompiled.js:768779) [C]; response includes `assets[]` and `last_updated_at`; refetch interval depends on REAL_TIME subscription. Egypt-only (`useEGMarketWatchAssetsWrapper`).

**Day snapshot** — `GET apiGateway /asset/v1/day-snapshot?asset_id={id}&is_delayed={bool}` → `data.results[0].previous_close` (M5461 `getDaySnapshot`, simplified.js:835683) [C].

**Firebase RTDB realtime** (M4298 `useRealtimeFeed`, M4302/M4303/M4304) [C]:
- DBs: main `https://thndr-api.firebaseio.com` (resources.arsc), replicas `https://thndr-api-replica.europe-west1.firebasedatabase.app`, `https://thndr-api-replica-2.europe-west1.firebasedatabase.app`; one of `main|replica_1|replica_2` picked at random per session (`getReplicaTarget`, M4311).
- Legacy path `marketFeed/{assetId}/{key}`, keys `price`, `previous_close`, `price_field`.
- New path (flag `mobile_securities_realtime_feed_asset_price_path`, key `price`): `assetPrice/{assetId}/price/last/value` (stocks) or `assetPrice/{assetId}/price` → `{bid:{value}, ask:{value}}` (gold index).
- ADX order book: `abudhabiPriceDepth/{assetId}` (`FEED_PATH`, M3749).
- Only subscribed users (`useIsSubscribedFeatureBased(REAL_TIME)`) or assets with `metadata.is_realtime_price_enabled` get RTDB; otherwise the app polls `/assets-service/assets/{id}?include_feed=true&feed_detail=true` and reads `.feed`, refreshed on 15-minute boundaries (`getTimeTillNextUpdate`) [C]. RTDB is used for egypt and (flagged) abudhabi only; **US has no realtime path** in the app.
- No websocket / `relay.thndr.app` usage found in market data (relay is elsewhere).

### 2.4 Price history
Chart intervals `MOBILE_CHART_INTERVALS` (M1876): `1d, 1d-1min, 1w, 1w-1h, 1M, 6M, 1y, 1y-1d, 2y, all` [C].

**Routing** (`getAssetChartData`, M5461 simplified.js:~835800; V2 in M5620) [C]:
- If `asset.market == egypt && asset_class == STOCK && flag mobile_securities_serve_charts_from_feed_histroicals` → feed-historicals (KrakenD) endpoints below.
- Otherwise (**all US, UAE, indices, ETFs, funds**) → `GET thndrApi /assets-service/charts?asset_ids={id}&option={MOBILE_CHART_INTERVALS[i]}&market={asset.market}` (repeated `asset_ids`), response `{[assetId]: {ISO-time: price}}` (`getAssetChartFromAssetsService`). `market` is the instrument's own market (`us`, `adsm`, `egypt`).

Feed-historicals (Egypt stocks) [C]:
- `GET apiGateway /charts/v1/line-chart/{id}?resolution&interval&is_delayed` → `{asset_id, aggregated_trades:[{timestamp, close}], previous_close}` (`getLineChart`).
- With flag `mobile_securities_use_splitted_chart_endpoints`: `GET apiGateway /asset/v1/{id}/aggregated-trades/close?resolution&interval` (+ day-snapshot for 1D).
- `GET apiGateway /charts/v2/line-chart/{id}?resolution&interval` (M5617 `getEgyptStockLineChart`, errors `error_feed_historicals_service|error_asset_prices_service`).
- `LINE_CHART_INTERVAL_MAPPING` (M3564): 1d→5MIN/1D, 1d-1min→1MIN/1D, 1w→10MIN/1W, 1w-1h→1HR/1W, 1M→1HR/1M, 6M→1D/6M, 1y→1W/1Y, 1y-1d→1D/1Y, 2y/all→1W/5Y.
- `is_delayed = !(interval==1D && subscribed && RealTimeCharts(market))` → always true for US/UAE.

Candlesticks (markets egypt, us) (`getAdvancedChartData`, M5213) [C]:
- Egypt stock + feed flag: `GET apiGateway /charts/v1/candlesticks-chart/{id}` (v2 path with flag `mobile_securities_egypt_chart_feed_historicals_v2`) `?resolution&interval` per `CANDLESTICKS_CHART_INTERVAL_MAPPING` (1d→5MIN/1D, 1d-1min→1MIN/1D, 1w/1w-1h→1HR/1W, 1M→1D/1M, 6M→1W/6M, 1y→1W/1Y, 1y-1d→1D/1Y, 2y/all→1W/5Y).
- Else: `GET thndrApi /assets-service/charts/candlesticks?asset_id&chart_option&market`.
TradingView (flag `mobile_enable_tradingview_charts`): `GET apiGateway /charts/v1/ohlc-candlesticks/{id lower}?resolution&start_timestamp&end_timestamp` → `trades_candles[]` (error `error_advanced_charts_trades_candles`) (M8505) [C] — mobile twin of web `/feed/advanced-charts/v2/{id}/trades`.
Mutual funds: `GET apiGateway /charts/v1/mutual-funds/{symbol}?option`, legacy `GET thndrApi /assets-service/charts/mutual-funds/{fund}?fund_name&option` [C]. Gold: `GOLD_INDEX_SECURITY_ID 33633457-…`, gold V2 price via `securities/v2/price` (M4299) [C].

### 2.5 Order book & trades
- **Egypt** depth: `GET thndrApi /assets-service/market-depth/{id}` every 2 s (M1870/M1868) → `bids_per_price[], asks_per_price[], total_bids_and_asks{total_bids,total_asks}` [C].
- **UAE (adsm)** depth: **Firebase RTDB** `abudhabiPriceDepth/{assetId}` → rows `{bid:{price,quantity,orders_count}, ask:{…}}` (`useAdxRealtimePriceDepth`, M3820); needs `PRICE_DEPTH` subscription for ADX and ADSM eligibility (`useLevel2MarketDataVisibility`, M3828) [C].
- **US**: no depth or trades book [C: `shouldShowTradesBook` = market==egypt; depth only egypt/adsm].
- Trades book (Egypt only): `GET thndrApi /assets-service/market-depth/{v2|v3}/trades-book/{id}?page_size=20&before={last_cursor}&after={first_cursor}`; `v3` with flag `mobile_marketdata_trades_book_v3`, default `v2` (decompiled.js:1355308) → `{trades[], first_cursor, last_cursor}`, v2 trades have `side: BUY|SELL` [C].

### 2.6 News
- **US**: `GET apiGateway /news/v1/market?markets=us&asset_id={id,id…}&page&page_size` (M5555 `getUSNews`) → `{count, next, results:[{id, title, link, source, created_at, stocks:[{asset_id}]}]}`, error `error_news-service` [C].
- **Egypt & others** (any market ≠ `us`, M5552 `fetchNewsPage`): `GET apiGateway /explore/v1/news/articles?page&page_size&source*&category*&sentiment*&asset_id*&scope&search&from_date&to_date` (M5557) → `results[{key,title,title_i18n,link,source,summary_i18n,sentiment,category,scope,asset_ids,published_at|added_at}]`, `count,next`, error `error_get_news_articles`; page size 15 [C]. Sources: `GET apiGateway /explore/v1/news/sources` → `news_sources` [C].
- Per-security (portfolio): `GET apiGateway news/v1/asset?asset_id={ids}&locale&page&page_size` → `results[{created_at, link,…}]` (M7769) [C].
- Legacy: `prod.thndr.app/api/post/news/` with `asset_id, locale, markets, page` (M1881, service registry M4125) [C].

### 2.7 Dividends
- `GET thndrApi assets-service/assets/{id}/dividends?page&page_count` (M4405) → items `id, record_date, ratio, dividend_type (CASH|STOCK), status (UPCOMING|ONGOING|PAST), currency, distributions[{date,…}]` [C fields from M5464].
- `GET apiGateway securities/v1/{id}/dividends?page&page_count=5&status&sort_direction` (M5827, `error_get_security_dividends`, dates normalized: `created_at, updated_at, distributions[].date`) [C].
- `GET apiGateway /securities/v1/{id}/dividends/total?interval&dividend_type` (M5590) and bulk `GET /securities/v1/dividends/total?asset_id…&dividend_type&interval&status` → `items[{asset_id,…}]` (M5876) [C]; `/dividends/v1/total/{x}` (M5492) [C]. Market availability not gated in code [I: all markets with data].

### 2.8 Movers, trending, indices
- Gainers/Losers (legacy Explore): `GET thndrApi assets-service/assets/rank?limit=9&market={selectedMarket|egypt}&type=GAINERS|LOSERS&duration=1D|1W|1M|6M|1Y&include_feed=true&feed_detail=true` → `{assets_ranked[], last_updated_at}` (M1929/M8077) [C]. Refetch 60 s when real-time subscribed for that market (M8081).
- Trending (V3): `GET apiGateway /explore/v1/assets/trending?market={selectedMarket}&count=20[&asset_class=STOCK]` → `results` = asset ids (error `error_get_trending_assets`) (M8045) [C]. Legacy: `GET thndrApi /assets-service/assets/trending?market={m}&feed_detail=true&include_feed=true` (M1920); old registry also has `/assets-service/assets/top_performers?market=` (M4125) [C].
- No "most active" endpoint found.
- Indices (V3): `GET apiGateway /explore/v1/default-market-indicators?market=…` (repeated) → `default_market_indicators.indicators` (M8015); market order per selected market (M8014): egypt → `egypt,us,tdwl,abudhabi`; us → `us,tdwl,abudhabi,egypt`; abudhabi → `abudhabi,us,tdwl,egypt` (**`tdwl` = Saudi Tadawul**) [C]. Items carry `asset_id` (prices via securities/v2/price; realtime only for `REALTIME_MARKET='egypt'`). User picks: `GET /explore/v1/user-market-indicators?market=` → `user_market_indicators.indicators`; `PUT` same path `{market, indicators}` (not money) [C].
- Legacy: `GET thndrApi assets-service/assets/market-indicators?page_count=100&feed_detail=true&include_feed=true&include_usd_rate=true` (filters out asset `b0a4c53e-b12f-4e93-b94b-759b8eeaef14`, likely the USD rate) and `/assets-service/user-market-indicators?feed_detail=true&include_feed=true` (GET/PUT `{assets_ids}`) [C].

### 2.9 Research / analyst data (legacy, via service registry M4125 + request helper M6475) [C paths, I usage]
- `GET prod.thndr.app/assets-service/assets/{id}/analytics` — analyst rating (fair value, potential change up/down, rank `SIGNIFICANTLY_UNDERVALUED…SIGNIFICANTLY_OVERVALUED`, good/bad review cards, last updated) (M6547 `getAnalytics`, UI M5317); `/assets/{id}/analytics-report` → report URL.
- `GET /assets-service/analysis/financial|consensus|technical/{assetId}` (M6598 `getFinancials/getAssetConsensus/getAssetTechnical`).
No market gating found; data likely Egypt-only [I].

---

## 3. Account endpoints per market (wallet, portfolio, orders, activity, returns, lists, alerts, savings)

Evidence refers to `out/simplified.js` line numbers (`S:<line>`) and Metro module ids (`M<id>`). Clients:
`thndrApi` = `https://prod.thndr.app/` (BASE_API from BuildConfig, or `https://prod-eks.thndr.app/` when the Unleash flag
`mobile_eks_cluster_enabled` is on); `apiGateway` = `https://prod.thndr.app/krakend-thndr-app` (mobile KrakenD, **not**
the web `krakend-thndr-x`). Both use the same request interceptor (`Authorization: <prefix> <token>`, `X-DUID`,
`sessionId`, `X-Language`, `x-correlation-id`). Gateway responses use the KrakenD "error-in-200" pattern: each section
can come back with an `error_<section>` key instead of data (`M1738 extractErrorCodeAndDetails`, `M4300 toResult`).

### 3.0 Market and provider values used by account calls [C]

| UI market | `market` param on account calls | activities `provider` (`wallet/v1/activities`, `funding-service/account-activities`) | wallet-requests `funding_provider` | statements / funding-request `provider` | `activities-service` `market` | currency |
|---|---|---|---|---|---|---|
| Egypt | `egypt` | `EGID` | `EGID` | `EGID` | `egypt` | EGP |
| US | `us` | `ALPACA` | **`ALPACA_UAE`** | `ALPACA` | `us` | USD |
| UAE (ADX) | **`abudhabi`** | `ADX_UAE` | `ADX_UAE` | `ADX_UAE` | **`uae`** | AED |
| Simulator | `simulator` | `EGID` | n/a | `THNDR` | `egypt` | THNDR (points) |

- `adsm` is never sent for account data. `validateSelectedMarket` (M2619, S:444985ff) throws `'Deprecated Selected
  Market'` when the selected market is `adsm` or `deprecated_uae`; orders (`useInfiniteOrdersData`, M3580) and price-alert
  creation (`useCreatePriceAlert`, M5925) rewrite `adsm` → `abudhabi`. `adsm` is the UAE **market-data** value only.
- Maps: `ACTIVITIES_MARKET_FUNDING_PROVIDER = {egypt:'EGID', us:'ALPACA', abudhabi:'ADX_UAE'}` (M5845, S:873559);
  `REQUESTS_MARKET_FUNDING_PROVIDER = {egypt:'EGID', us:'ALPACA_UAE', abudhabi:'ADX_UAE'}` (M7681, S:1088246; same in
  M7720); `MARKET_PROVIDER_MAP` (M534, S:118386: egypt→EGID, us→ALPACA, simulator→THNDR, abudhabi→ADX_UAE; M2772 adds
  `uae`→ALPACA_UAE); `MARKET_PROVIDER_NAME_MAP` (M534: egypt/simulator→EGID, us→ALPACA, abudhabi→ADX_UAE);
  `MARKET_NAME_TO_MARKET_MAP` (M534: egypt/simulator→`egypt`, us→`us`, abudhabi→`uae`); `MARKET_CURRENCY_MAP` (M534:
  simulator→THNDR, egypt→EGP, us→USD, abudhabi→AED); `PROVIDER_MARKET_MAP` maps both ALPACA and ALPACA_UAE → `us`.
  `home/v1/pending-transactions-preview` uses `{egypt:'EGID', us:'ALPACA_UAE', abudhabi:'ADX_UAE', adsm:'ADX_UAE'}` (M7452).
- US gate: `useMarketWalletAndPortfolio` (M2914) skips `wallet-and-portfolio` for `us` when the profile has no
  `alpaca_id` ("WalletAndPortfolio is disabled for us market as user has no alpacaId yet").
- Per-market maintenance switches (Unleash): `mobile_portfolio_maintenance_{eg,us,adx,clouds}`,
  `mobile_wallet_maintenance_{egypt,us,adx}`, `mobile_wallet_disable_funding`.
- Custodian (Egypt holdings split): `Custodian = {THN, AUB, OTHER}` (M2742/M3575).

### 3.1 Wallet & portfolio

| Endpoint | Client | Request | Response read | Markets | Ev. |
|---|---|---|---|---|---|
| `GET market-service/accounts/wallet-and-portfolio?market=<m>` (legacy, as on web) | thndrApi | — | `market_name, purchase_power, cash_in_holding, settled_cash, unsettled_cash, last_updated_at, portfolio{portfolio_value, total_return, total_return_prc, positions[]}` | egypt, us (needs `alpaca_id`), abudhabi, simulator | M2748 `getWalletAndPortfolio` S:460287; M2769 defaults [C] |
| `GET wallet/v1/summary?market=<m>` | apiGateway | — | wallet half of the above: `market_name, purchase_power, cash_in_holding, settled_cash` (+`unsettled_cash` [I]). UI: total = `purchase_power + cash_in_holding` (M7491), unsettled = `purchase_power - settled_cash` (M7977) | all | M6952 `getWalletSummary` S:1023306; M2756 `mirrorWalletToLegacy` [C] |
| `GET /portfolio/v1/info?params market` | apiGateway | `{market}` | portfolio half: `portfolio_value, total_return, total_return_prc, positions[]` (positions also carry real-estate `property_metadata, property_number`) | all | M7757 `getPortfolioInfo` S:1093000; M2754 sync code [C]/[I] |
| `GET home/v1/holdings?market=<m>` | apiGateway | `{market}` | `{wallet, portfolio, clouds}`; `clouds` kept **only for egypt**; partial failure → `PartialResponseError`. Positions aggregated from `market_value, gain_loss, cost_value`; clouds from `total_amount, total_gain` | all | M7712 `getHoldings` S:1090210; M7492/M7493 [C] |
| `GET market-service/accounts/portfolio-info?market=<m>` | thndrApi | — | (`getPortfolioValues`; fields not traced) | all | M2748 S:460081 [C path] |
| `GET market-service/accounts/purchase-power?market=<m>` | thndrApi | — | number (`purchase_power`) [I] | all | M2786 S:462950 |

### 3.2 Positions [C]
- `GET /market-service/accounts/positions?market=<m>` (thndrApi, `getOwnedSecurities`, M2748 S:460115): array; UI keeps
  `qty > 0` (M2747).
- `GET /market-service/accounts/positions/{assetId}?market=<m>` (`getSecurityPosition`, S:460149).
- `GET /market-service/accounts/positions/blocked-quantities/{assetId}?market=<m>` (S:460183). Position shape (defaults
  in M2764): `asset_id, symbol, name, logo, currency, qty, qty_settled, qty_t0, qty_t1, qty_per_custodian[{qty,custodian}],
  qty_settled_per_custodian, qty_t0_per_custodian, qty_t1_per_custodian, unsalable_qty_per_custodian, market_value,
  cost_value, market_price, avg_cost, gain_loss, gain_loss_percentage, portfolio_percentage`.
- Pending orders for one asset: `GET market-service/orders?market=<m>&asset_id=<id>&status=PENDING` and
  `market-service/v2/orders?…` (same params, `getSecurityPendingOrders[V2]`, S:460218/460253).
- Social: `GET /users-service/users/{uid}/portfolio?market=<m>` (M6561 `_getUserPortfolio`).

### 3.3 Orders (read side) [C]
- **List**: `GET market-service/v3/orders` (thndrApi, `getOrders`, M3580 S:552988 and M6032) params
  `{limit, cursor, status, asset_id, market}`; `status ∈ ORDER_STATUS_FILTER {PENDING, CANCELLED, COMPLETED, CLOSED}`;
  response `{data:[order], has_next, cursor}` (cursor pagination, `getNextPageParam` → `cursor` when `has_next`).
  Orders can carry `order_pairs[]` with `stop_loss` / `take_profit` `{id, status ('Cancelled'|'Triggered'|…), type
  ('Limit'|…), trigger_price, qty}` (bracket orders, flag `mobile_orders_bracket_trading_experience`), expanded by
  `extractStopOrders` into synthetic `StopOrder` rows. `market` adsm→abudhabi.
- History: `GET /market-service/v2/orders?market=<m>&sort_order=DESC` (M5248/M6319 `useOrdersHistory`);
  `GET /market-service/orders?market=<m>&asset_id=<id>&sort_order=DESC` (M3583).
- **Detail**: `GET market-service/orders/{orderId}?market=<m>` (thndrApi, M5573 `useGetOrderDetailsData`), used by the
  stock order details screens; `GET /orders/v1/{orderId}?market=<m>` (apiGateway, M8388 `getOrderDetails`) used only by
  the **Gold** and **Real-Estate** order details screens (M8387/M8410). Dates normalised from
  `ORDER_DATE_FIELDS = created_at, updated_at, execution_time, cancelled_at, time_in_force_date, provider_last_updated_at`.
- Order fields read by detail UIs (M5572/M6357/M6368): `stock_id, asset_id, market_name, asset_class, order_type,
  order_class, sub_order_class, order_status, order_status_details, is_limit, limit_price, trigger_price, market_price,
  amount_filled, total_fees, time_in_force (day|date|gtc|ioc|fok), time_in_force_date, execution_type (DEFAULT |
  ALL_OR_NONE | MINIMUM_FILL | NO_FILL), minimum_fill_volume, is_persistent, persistent_order_number,
  persistent_order_placed, is_extended_hours_order, is_subscription, is_right, is_ipo, is_cancelable, is_editable,
  is_tradable, stock_status, rejection_reason, rejection_reason_value, created_at, order_pairs`.
  Enums: `OrderStatus` (QUEUED_SUBMIT, PENDING, FULFILLED, PARTIALLY_FILLED, CANCELLED, REJECTED, EXPIRED, *_MCDR, …),
  `OrderClass {Bracket, StopOrder, TakeProfit}`, `Currencies {EGP, USD, SAR, AED}` (M3575).
- Recurring: `GET market-service/orders/recurring-configs?market=<m>`, `GET market-service/orders/recurring-configs/{id}?market=`
  (thndrApi, M5256/M5257); `GET /orders/v1/recurring-configs?market=&asset_class=` (apiGateway, M8407).
- Write endpoints (exist, not documented — out of scope): `POST /market-service/orders?market=`, `POST /orders/v1/submit-order?market=`,
  `POST /v1/orders/mf-order`, `PATCH market-service/orders/{id}/edit`, `PATCH /orders/v1/{id}/cancel`,
  `PATCH /orders/v1/stop-orders/{id}/cancel`, `PATCH /market-service/stop-orders/{id}/cancel`, subscription/rights
  orders (`…?market=egypt` only), recurring create/cancel, `POST …/calculate-fees`, `POST /orders/v1/max-cash-and-units`.

### 3.4 Account activity / transactions [C]
Three generations coexist:
1. `GET funding-service/account-activities` (thndrApi, M5488 `getAccountActivities`) params
   `{provider, activity_filter, asset_id, page, page_size (default 10)}`, provider = `MARKET_PROVIDER_NAME_MAP[market]`
   (EGID/ALPACA/ADX_UAE). Used by `useWalletActivities` (M6404) when `mobile_wallet_activities_new_service` is **off**.
2. `GET activities-service/user-activities` (thndrApi, M6405) params `{market, activity_filter, page, page_size: 10}`
   with `market = MARKET_NAME_TO_MARKET_MAP[market]` (egypt|us|**uae**); used when that flag is **on**. Filter = wallet
   tab `WalletTabKey {ALL, LIMITED_FUNDING, INVESTMENT, OTHER}` (ALL → no filter).
3. `GET wallet/v1/activities` (apiGateway, M5845 `getActivities`, S:873581) params
   `{provider: ACTIVITIES_MARKET_FUNDING_PROVIDER[market], page (default 1), page_size: limit, activity_filter, asset_id}`
   → `{count, results[]}`; each result's `ordering_id` becomes `id`, `created_at` parsed. Dividend history for one asset
   = `activity_filter='DIVIDEND'` + `asset_id` (M5844). Activity types (M534 `ActivityType`): BUY_ORDER, SELL_ORDER,
   SUBSCRIBE_ORDER, ACCOUNT_DEPOSIT_FUND, ACCOUNT_WITHDRAW_FUND, DIVIDEND, DIVIDEND_NRA, REWARD, BANK_FEES,
   SUBSCRIPTION_FEES, TO_SAVINGS, FROM_SAVINGS, GIFT_CARD_*, CASH_DEDUCTION, WITHDRAWAL_FEES, DEPOSIT_FEES,
   COMMISSION_KICKBACK, SETTLEMENT_FEES, MCDR_ANNUAL_FEES, …
- `GET /wallet/v2/transactions-preview` (apiGateway, M7970) params `{provider: ACTIVITIES map, funding_provider: REQUESTS map,
  page_size, page_count}` → `{activities{count,results}, requests{count,results}}` with `error_transactions_activities` /
  `error_transactions_requests`.
- `GET wallet/v1/requests` (apiGateway, M7681) query `funding_provider, page, page_count, status_filter (repeatable), side`
  → `{count, results[]}` (deposit/withdrawal requests). `GET wallet/v1/requests-count` `{funding_provider, status_filter}` (M7720).
  `GET wallet/v1/requests/{id}?provider=` (provider map with us→`ALPACA`, M7958).
- `GET home/v1/pending-transactions-preview` (apiGateway, M7452) params `{market, limit, page_count: limit,
  funding_provider}`; sections expected: egypt → `market_orders, wallet_requests, savings_transfers`; us/abudhabi →
  `market_orders, wallet_requests`; simulator → `market_orders`; each `{transactions[]}`.
- Legacy funding requests: `GET funding-service/funding-requests` `{provider, page, page_count, side, status, sort_by,
  transfer_type}` (M2778); `GET funding-service/v2/funding-requests/{id}?provider=` (M3481).
- Statements: `GET funding-service/account-statements/investor-since?provider=` and
  `GET funding-service/account-statements/custom-statement?provider=<MARKET_PROVIDER_MAP[m]>&date=<date>` (M2773/M2783).
- Money-moving endpoints exist (not documented): funding requests, withdrawals/deposits cancel, instant settlement,
  `/v1/wallet-funding/*` fees, checkout/Apple/Google Pay top-ups (`mobile_wallet_{us,adx}_checkout_*`), thndr-pay cards.

### 3.5 Returns & analytics [C]
- `GET /market-service/realized-returns?market=<m>` (M2766) → `portfolio_value, investment_value, wallet_value,
  savings_wallet_value, net_deposits, aggregate_deposits, aggregate_withdrawals, unrealized_returns, realized_returns,
  total_returns, snapshot_date`.
- `GET /market-service/realized-returns/chart/{interval}?market=<m>` (M2749 `getPortfolioChartData`) when
  `mobile_return_analytics_migrate_to_api_gw` is **off**; `GET /v1/portfolio-analytics/chart/{interval}?market=<m>`
  (apiGateway, `getPortfolioChartDataFromAPIGW`, error key `error_realized_returns_chart`, `[]` on error) when **on**.
  Intervals: `CHART_INTERVALS {1D:'1d',1W:'1w',1M:'1M',6M:'6M',1Y:'1y',2Y:'2y',ALL:'all'}` (M2222).
- `GET /v1/portfolio-analytics/snapshots?market=<m>` (apiGateway, M8301; same flag) → same fields as realized-returns
  (read in M8304 `usePortfolioAnalytics`).
- `GET /market-service/realized-returns/investor-since?market=<m>` (M2746) → investing start date.
- Availability: the Returns entry in the hub is shown only for `egypt` (flag `mobile_portfolio_egypt_returns`) or `us`
  (flag `mobile_portfolio_us_returns`) — **not for UAE/ADX** (M7005 `useHub`, raw decompiled.js around the flag) [C].

### 3.6 Trading journal [C]
Not in the mobile app: no `full-trades`, `grouped-sells` or `trading-metrics` strings/calls exist (only the web has it).

### 3.7 Watchlists [C]
- Default/favourites: `GET /asset/v1/watchlist?market=<m>` → `data.collection`; `PATCH /asset/v1/watchlist {asset_id}`,
  `DELETE … {data:{asset_id}}` (apiGateway, M5763; errors `error_get_watchlist`, …). Legacy `GET /assets-service/watchlist?market=`
  (thndrApi, M4423, used by `FeedFavoriteListLegacy` when `mobile_optimize_watchlist` is off).
- Custom lists: `GET lists/v1/user-watchlists?market=<m>` → `{watchlists}` (`error_fetch_watchlists`) (M5390);
  `GET lists/v1/user-lists?market=<m>` → `{watchlists}` (M8116; items carry `asset_ids`); `GET lists/v1/user-watchlists/{id}`
  (M8236, `error_fetch_watchlist`); write: `PATCH lists/v1/user-watchlists/{id}`, `PATCH lists/v1/user-watchlists/securities
  {asset_id, watchlist_ids_to_add, watchlist_ids_to_remove}`. Market value here is the market-data market [I: likely
  `adsm` for UAE since lists hold instruments — not confirmed].

### 3.8 Price alerts [C]
- `GET /price-alerts-service/price-alerts?page=&page_count=` → `{count, results}` (thndrApi, M6052);
  `GET /price-alerts-service/price-alerts/assets/{assetId}?page=&page_count=` (M5377);
  `POST /price-alerts-service/price-alerts` body `{asset_id, price|null, percentage|null, direction: UP|DOWN, frequency:
  ONE_TIME|RECURRING, notes, market}` with `market` = selected market (`adsm`→`abudhabi`, null→`egypt`) (M5925);
  `PATCH {prefix}/price-alerts/{id} {alertId, notes}` where prefix = `price-alerts-service` or legacy `assets-service`
  (M4376); `DELETE /price-alerts-service/price-alerts/{id}` (M5906).
- Per-market availability (`SECURITY_LANDING_FEATURES_MAP`, M3563 S:551680): PriceAlert = egypt ✓, us ✓, simulator ✗,
  ADX = flag `mobile_securities_adx_price_alerts`. ShouldUsePriceAlertsService = egypt flag
  `mobile_securities_eg_use_price_alerts_service`, us flag `mobile_securities_use_price_alerts_service`, ADX ✓, simulator ✓
  (otherwise legacy overmind `securities.createPriceAlert`). Notes gated by `mobile_securities_price_alert_notes`.
  Enums: `AlertTypes {CUSTOM, OWNED_ASSET, WATCHLIST}` (M4275).

### 3.9 Notifications [C]
No market param: `GET notifications-service/notifications?page=<n>&page_count=15` (M2473), `GET notifications-service/notifications/count`
(M2482), `PATCH notifications-service/notifications/{id}?field=is_read`, `PATCH notifications-service/notifications/batch?field=is_read`
(`NotificationsField {IS_READ:'is_read', IS_DISMISSED:'is_dismissed'}`, M2465). Items read `is_read, created_at, rumble_id`.

### 3.10 Savings ("Clouds") — Egypt only [C]
Holdings return clouds only for `egypt`; pending preview `savings_transfers` only for egypt; `CloudType {MONTHLY_EGP,
INSTANT_EGP}`; flags `mobile_wallet_savings_clouds`, `mobile_clouds_*`. Read endpoints:
`GET v1/wallet-clouds/clouds` (M7450); `GET savings-service/clouds` (legacy, M2852 → `total_amount, total_gain,
amounts_per_type`); `GET /v1/wallet-clouds/all-asset-stats` (M2877, `currently_earning`); `GET clouds/v1/transfers`
`{status, page, page_count}` (M7744); `GET clouds/v1/transfer/{cloudId}/transactions?status=…` → `{count, activities}`
(M7923); `GET clouds/v1/daily-gains/yearly?year=&cloud_type=…` → `by_cloud_type` (M7870); `GET clouds/v1/creation-date`;
`GET /v1/wallet-clouds/transfer-types/{type}`, `GET /clouds/v1/transfer-types/{type}`, `GET /v1/wallet-clouds/transfers/{id}/transfer-requests`.
Cloud fields: `cloud_type, goal_amount, goal_date, withdrawable_amount, currently_earning, total_amount, total_gain`;
transfer fields `amount, fees, total_amount, transfer_amount, created_at, scheduled_for, status (COMPLETED|PENDING|PROCESSING|CANCELLED|FAILED)`.
Create/transfer/delete endpoints exist (money movement, not documented).

### 3.11 Dividends received [C]
- `GET /wallet/v1/dividends/total?asset_id=A&asset_id=B…` (apiGateway, M5841) → `items[]` keyed by `asset_id`
  (`error_total_received_dividends`): user's received dividends per held asset.
- `GET /dividends/v1/total/{assetId}` (apiGateway, M5492, `getTotalDividends`, used by M5487 position/dividend widget).
- Security-level totals `GET /securities/v1/dividends/total?asset_id=…&dividend_type=&interval=&status=` and
  `/securities/v1/{id}/dividends/total` are market data (see market-data section).

---

## 4. Transport, and read-only extras the web bundle lacks

Evidence refers to Metro module ids (`M####`), function names and line numbers in `out/simplified.js` (`s:N`).
Raw code is in `out/decompiled.js`, at the line given in each module header. **[C]** means confirmed in code. **[I]** means inferred.

### 4.A Transport

#### 4.A.1 The three axios clients (M1657, s:326717–326935) [C]
```js
thndrApi      = axios.create({ baseURL: M1814.BASEURL,              headers: { 'X-DUID': getUniqueDeviceID() } })
apiGateway    = axios.create({ baseURL: M1814.API_GATEWAY_BASE_URL, headers: { 'X-DUID': getUniqueDeviceID() } })
serverlessApi = axios.create({ baseURL: M1814.BASEURL, ... })
```
- **Base URLs (M1814).** `BASEURL = "https://" + BuildConfig.BASE_API + "/"`. The dex holds `BASE_API` next to the string `prod.thndr.app` (classes2.dex), so this is `https://prod.thndr.app/` [I, strong]. When the Unleash flag `mobile_eks_cluster_enabled` is on, BASEURL becomes `https://prod-eks.thndr.app/` [C].
- **API gateway.** `API_GATEWAY_BASE_URL = https://prod.thndr.app/krakend-thndr-app` (staging: `staging.thndr.app/krakend-thndr-app`) [C]. This is a different KrakenD gateway from the web's `krakend-thndr-x`, and its path set is different (`/securities/v1/*`, `/explore/v1/*`, `/asset/v1/*`, `/charts/v1|v2/*`, `/wallet/v1/*`, `/portfolio/v1|v2/*`, `/orders/v1/*`, `lists/v1/*`, `home/v1/*`, `clouds/v1/*`, `news/v1/*`, `dividends/v1/*`).
- **Getting a device id.** `getUniqueDeviceID()` returns `DeviceInfo.getDeviceId() + "-" + getUniqueIdSync()` (M1815) [C].
- **Request interceptor `addInterceptors` (installed on all three clients):**
  - `Content-Type` and `Accept` are both `application/json`.
  - `authorization: (headers.headerPrefix ?? "Bearer") + " " + token`, where `token = M1684.getToken()`. The default prefix `'Bearer'` is confirmed in decompiled.js around line 701880 [C].
  - `sessionId: <sessionID>`, `X-Language: <locale.languageTag>`, `x-correlation-id: <uuid>`.
  - `user_id: <getUserId()>`, sent only when the flag `mobile_add_user_id_request_header` is on [C].
- **Response interceptor.** It logs the response. When `mobile_reject_non_json_200_bodies` is on, a 200 response with a string body matching an OS network-drop message is rejected [C]. There is **no** refresh or retry interceptor (unlike the web's 401/403 refresh).
- **The token (M1684, s:~561000) [C].**
  - A single `AUTH_TOKEN` is kept in secure storage, together with a decoded copy.
  - `isTokenExpired()` is true when fewer than 100 s remain before `exp`, corrected for clock skew using `iat`.
  - When `mobile_auth_enable_cancel_request_if_token_expired` is on, `cancelRequestIfTokenExpired()` aborts calls made with an expired token.
- **Getting the token.** The token is the **`APP_TOKEN`** returned by `POST auth-service/v2/tokens/full-access` with body `{credentials:{firebase_token, challenge_token, response_token, pin, password}}` (`_getAppToken`, s:944853). It is stored with `setToken(...)` (s:952575). The flow behind it is: `POST auth-service/v2/tokens/challenge` sends `{credentials:{firebase_token}}`, then the device signs the challenge with its key pair (`response_token`) plus the PIN or biometrics.
- **Same token as the web?** This is the same `full-access` endpoint the web uses, so it is the same FULL_ACCESS JWT family [I]. The mobile app re-mints the token through the device-key challenge; the web uses a refresh cookie. The mobile app has no `/api/auth/refresh`.
- **Token types.** `AUTH_TOKEN_TYPES = {FIREBASE_TOKEN, APP_TOKEN, LIMITED_TOKEN}`. The limited token comes from `POST auth-service/v2/tokens/limited-access` with `{credentials:{firebase_token}}` [C].
- **Same token on all prefixes.** The same interceptor and token serve `thndrApi` and `apiGateway`. So every `prod.thndr.app/<service>` path and every `prod.thndr.app/krakend-thndr-app/<path>` takes the same Bearer token [C, by construction].

#### 4.A.2 Legacy "serviceName/functionName" dispatcher (M4125 registry, M4124 URL builder, M6475 `request`, M4126 auth) [C]
- **URL.** The URL is built as `https://${BASE_API}${service}${service.path}${fn.path}[/${urlExtension}][${pathPostfix}]` (M4124 `parseUrl`). A call can override it with an explicit `url`.
- **Auth.** `Authorization` uses `state.authentication.authTokens.APP_TOKEN` with the per-service `headerPrefix` (`Bearer`, or `Auth` for some `auth-service/v2|v3/users` calls). Requests also carry `X-DUID` and `x-correlation-id`.
- **Callers.** Older Overmind "effects" still use it (`securities.*`, `research.*`, `feedV2.getNews`, `graph.*`). This is where most of the extra research endpoints in §B come from.

#### 4.A.3 KrakenD error-in-200 handling in the mobile app [C]
- `M1738.extractErrorCodeAndDetails(resp)` collects every top-level key starting with `error_` whose value is an object, into `errorDetails` (each `{http_status_code, http_body}`). It also sets `isCompleteFailure`, true when every key is an error.
- `isCompleteResponse(headers)` checks `headers['x-krakend-completed'] === 'true'`.
- `M4300.toResult(data, errorValue, normalizer)` returns `{ok:true,data}` or `{ok:false,error}`. Gateway responses are keyed per section, for example `{day_snapshot, error_asset_day_snapshot_v2, price, error_asset_price_v2}`.
- `M8268.canTransformToKrakendError` and `toKrakendErrorData` wrap errors into the same shape.
- A client must treat any `error_<section>` key as that section failing.

#### 4.A.4 Calls whose URL is a variable (resolved) [C]
| module / fn | resolved request |
|---|---|
| M1692 `useAPIGateway({path, queryParams})` | Generic `apiGateway.get(path,{params})`. It is exported but has no callers in 12.56 (dead code). `useThndrQuery` is also unused. |
| M5514 `_getSecurityPrice`, M4299 `PRICE_ENDPOINT` | `GET {gw}/securities/v2/price?asset_id=A&asset_id=B…` (sorted, repeated). `Cache-Control: no-store` is sent when `disableGWCache`. Response: `{day_snapshot, price}` with `error_asset_day_snapshot_v2` / `error_asset_price_v2`. Fund prices carry `nav` (M5516 `isNavPrice`). |
| M5755 `_getGoldIndexV2Chart` | `GET {gw}/charts/v1/quotes/{GOLD_INDEX_SECURITY_ID}/fixed/close?interval=&resolution=`. Error key `error_get_candles_quotes_close`. `GOLD_INDEX_SECURITY_ID = 33633457-d544-403a-960d-a7acaaae74c1`. |
| M5213 `getCandleSticksChart` | `{gw}/charts/v1/candlesticks-chart/{assetId}?resolution=&interval=`. A fallback (`getAdvancedChartFromAssetsService`) uses `assets-service/charts/candlesticks`. |
| M5779 `getPosition` | `{gw}/portfolio/v1/position/{assetId}?market=` (key `fetch-security-position`). |
| M5788 `_getOrders` | `{gw}/orders/v1/` with params. |
| M5827 `getSecurityDividends` | `{gw}/securities/v1/{assetId}/dividends?page=&page_count=&status=&sort_direction=` (error `error_get_security_dividends`). |
| M8450 `getUpcomingRentSchedule` | `{gw}/securities/v1/{assetId}/real-estate/rent-schedule/upcoming?page=&page_count=` → `{ongoing, upcoming}` (+ `error_fetch_*_rent_schedule`). |
| M7485 `_getCloudsAssetStats` | `{gw}/v1/wallet-clouds/all-asset-stats` → `{currently_earning, last_updated_at, nominal_yields:{daily,weekly,monthly,quarterly,semi_annually}}`. |
| M7775 `getAggregatedOrders` | `{gw}/portfolio/v2/aggregated-orders?market=&limit=&asset_class=`. Recurring configs are not offered for `simulator`. |
| M8097 `getFeedRumblesV2` | `{gw}/users/v2/rumbles-feed?market=&cursor=&limit=` → `{feed_items, has_next, next_cursor}` (social). |
| M8240 `_getMarketWatch` | `{gw}/securities/v1/marketwatch` (the gateway's marketwatch; the market-data section has details). |
| M8268 `deleteWatchlist` | `DELETE {gw}/lists/v1/user-watchlists/{id}`. |
| M8500 `getAssetPriceAlerts` | `{gw}/price-alerts/v1/asset-alerts/{asset_id}?page=&page_count=`. |
| `serverlessApi` M2149/M2581/M2153 | Branch referral-link handler and "return card" image generator, on AWS API-GW (`uvp0j7nocg…/production/branch-link-handler`, `bnz5hrmsk0…/production/generate-return-card-image`). Marketing only. |
| `httpClient` M6447 | `https://distributions.crowdin.net/{distributionHash}/manifest.json`: OTA translation strings. |

#### 4.A.5 Other hosts [C]
- **`https://chat.thndrapp.ai` ("Thndr Alpha" AI chat, M6201/M6202).**
  - It is a WebView opened at `https://chat.thndrapp.ai/{path}?token_request_id={id}`.
  - A JS bridge (`AlphaWebviewBridge`) answers `token_request_id` and `token_refresh_id` messages with the app token, and sends `api_host = "https://" + BASE_API + "/ai-chatbot-service"`.
  - The chatbot's REST calls are made by the web page, not by the bundle, so their paths are unknown.
- **`https://x.thndr.app/webview` (M7342 `ThndrXWebview`).** It embeds the ThndrX web app in a WebView.
- **`https://trading-view-red.vercel.app/?assetId=&market=&theme=&locale=&mode=fullscreen` (M8465).** Full-screen TradingView chart in a WebView.
- **`https://thndr-app-web-views.vercel.app/thndr-scores`.** WebView fed with the `/v1/thndr-scores/scores` payload through a bridge (M7334).
- **`https://relay.thndr.app`.** The PostHog analytics host (`POSTHOG_API_HOST`), not an API.
- **`https://unleash.thndr.app`.** Feature flags.
- **`https://pay.thndr.app/api`.** Thndr Pay cards: money, out of scope.
- **therumble.app.** Appears only in links and copy. The app has no Rumble-API client; the ThndrX `/thndrx/*` advisory content is absent.
- **`63555f5f483f5d2df3b31783.mockapi.io`.** A dev mock (s:335526).

---

### 4.B New read-only features, prioritized (requested section B)

Each item has: endpoint (`{gw}` = `https://prod.thndr.app/krakend-thndr-app`, `{api}` = `https://prod.thndr.app`), markets, and whether the same Bearer token works.
Unless noted, the token is the same APP/FULL_ACCESS Bearer token [C, by client construction]. Response fields are those the UI reads.

**P1. US analyst rating, fair value and bull/bear case (Morningstar)** [C]
- Requests:
  - `GET {api}/assets-service/assets/{assetId}/analytics`
  - `GET {api}/assets-service/assets/{assetId}/analytics-report`, which returns `{report_url}` (a PDF, opened in the PDF viewer).
- Source: legacy effects `securities.getAnalytics` / `getAnalyticsReport` (M6549, s:961105/961133), consumer `useAnalystRating` (M5328).
- Fields read: `analytics.fair_value`, `.rate` (rank), `.last_updated_time`, `.analyst_report.{bull_say_list, bear_say_list, name, title, last_updated_time}`. The UI computes upside as `fair_value / last_trade_price - 1`.
- Markets: shown only when `assetMarket === "us"`, the flag `us_funded_account` is on and `remove_morning_star` is off (M5309, s:98–146). The UI says "Powered by S&P Global" / Morningstar.

**P2. Dividends history and calendar per security** [C]
- `GET {gw}/securities/v1/{assetId}/dividends?page&page_count&status&sort_direction` (M5827).
- `GET {api}/assets-service/assets/{assetId}/dividends?page&page_count` (M4405 `useInfiniteSecurityDividends`, paginated until `results.length < page_count`).
- Item fields: `type` (`CASH`/`STOCK`), `status` (`UPCOMING`/`ONGOING`/`PAST`), `currency`, `ratio`, `created_at`, `updated_at`, `distributions[{date, amount, ratio}]`. The enums are in M3564 (`DividendType`, `DividendState`).
- Totals:
  - `GET {gw}/securities/v1/{assetId}/dividends/total?interval&dividend_type` (M5590, fund returns).
  - `GET {gw}/securities/v1/dividends/total?asset_id=…&dividend_type&interval[&status]` → `items[]` keyed by `asset_id` (M5876).
  - **Dividends the user received:** `GET {gw}/wallet/v1/dividends/total?asset_id=…` → `items` (M5841).
  - `GET {gw}/dividends/v1/total/{assetId}` (M5492).
- Markets: EGX stocks, funds and real estate confirmed by usage (flags `mobile_securities_dividend_distributing_funds`, `mobile_securities_account_for_dividends_in_equity_funds_returns`). US is likely [I].

**P3. Global and market overview indices** [C]
- Default indices: `GET {gw}/explore/v1/default-market-indicators?market=X[&market=Y]` (repeated `market` keys, M8015). Response key `default_market_indicators[].indicators[]`.
- Per-user indices: `GET {gw}/explore/v1/user-market-indicators?market=` (M8017). Response key `user_market_indicators[].indicators`.
- Indicator fields: `asset_id`, `symbol`, `market_indicator_name`, `market`, `asset_class`. Prices then come from `securities/v2/price`.
- Errors: `error_get_default_market_indicators` and the matching user-indicators key.
- Markets: called with the selected market (egypt / us / abudhabi).

**P4. Top movers, trending and leaderboards** [C]
- Trending: `GET {gw}/explore/v1/assets/trending?market&count&asset_class` → `results` (`error_get_trending_assets`, M8045).
- Legacy trending: `GET {api}/assets-service/assets/trending?market=&feed_detail=true&include_feed=true` (M1920).
- Ranked lists: `GET {api}/assets-service/assets/rank?limit=9&market=&type=&duration=&include_feed=true&feed_detail=true` (M1929).
  - `type` ∈ `GAINERS|LOSERS` (`AssetType`, M1860) [C].
  - `duration` ∈ `1D|1W|1M|6M|1Y` (`Duration`, M1860 S:349850) [C]. Response `{assets_ranked[], last_updated_at}`.
- Legacy effect: `GET {api}/assets-service/assets/top_performers?market=` (M6549). Whether it is still reachable is unknown [I].

**P5. Fund fact sheet, NAV and mutual-fund charts** [C]
- Fact sheet: `GET {api}/assets-service/assets/{id}` returns `expense_ratio`, `risk_profile`, `subscription_frequency`, `redemption_frequency`, `subscription_fees`, … (M5306 `useFactSheet`, M1917/M1918).
- NAV: `nav` in `securities/v2/price`.
- Charts:
  - `GET {gw}/charts/v1/mutual-funds/{symbol}?option=` → `[[timestamp, value]…]` (M5830).
  - Legacy: `GET {api}/assets-service/charts/mutual-funds/{fundName}?fund_name&option`, with `MOBILE_CHART_INTERVALS` `1d,1d-1min,1w,1w-1h,1M,6M,1y,1y-1d,2y,all` (M1911).
- Order windows: `GET {gw}/securities/v1/{fund_id}/execution-dates?start_date(ISO)&side&top` (error `error_fetch_execution_dates`, M5809).
- Markets: Egypt.

**P6. Instrument collections ("Thndr Lists", investment products, themes)** [C]
- Thndr Lists: `GET {gw}/explore/v1/thndr-lists?market=…&is_featured=true` → `results[]{id,name,small_sq_pic,assets_count}` (M7759; error `error_get_thndr_lists`). **`market=abudhabi` is sent as `adsm`** (decompiled.js ~2741056).
- Investment products: `GET {gw}/explore/v1/investment-products?market=` (M7809, same `abudhabi→adsm` mapping).
- Legacy investment products:
  - `GET {api}/assets-service/investment-products` (M1909).
  - `GET {api}/assets-service/investment-products/{id}?feed_detail=true&include_feed=true&market&page_count&page_number` (M1914).
- Themes and tags:
  - `GET {api}/assets-service/tags?random=&page_count=&market=` → `results` (M1926).
  - `GET {api}/assets-service/tags/{themeId}?market=&page_count=20&page=&feed_detail=true&include_feed=true` (M1928). This is the **tag → instruments listing that the web lacks**.
- Market filters (preset screens):
  - `GET {gw}/v1/market-filters?random&page&page_count&market` when `mobile_api_gateway_market_filters` is on; otherwise `GET {api}/assets-service/market-filters?…` (M2485/M2486).
  - `GET {api}/assets-service/market-filters/{id}?page&page_count=20&market&include_feed=true&feed_detail=true` (M1930).
  - Preview: `POST {api}/assets-service/market-filters/preview?page&page_count=20&market&include_feed=true&feed_detail=true` with body `query`. This is a read-only screen (M1873).

**P7. Technical analysis and research (legacy effects, M6598/M6599)** [C endpoints; whether the UI still reaches them is I]
- `GET {api}/assets-service/analysis/technical/{assetId}` → `technical_analysis_data`.
- `GET {api}/assets-service/analysis/technical?period=Daily|Weekly|Monthly&asset_class=STOCK|INDEX` → `results[]{asset_id, symbol, …}` (technical report; `Trend` = `up|sideways|down`).
- `GET {api}/assets-service/analysis/financial/{assetId}`.
- `GET {api}/assets-service/analysis/consensus/{assetId}`.
- Markets: Egypt [I].

**P8. Account statements and "investor since"** [C]
- `GET {api}/funding-service/account-statements/custom-statement?provider={P}&date=` (M2783 `requestAccountStatement`).
  - This is a GET with a side effect: it asks the server to generate or email a statement. It is not a data read.
  - `P` comes from `MARKET_PROVIDER_MAP` (M2772): `egypt→EGID`, `us→ALPACA`, `uae→ALPACA_UAE`, `abudhabi→ADX_UAE`, `simulator→THNDR`.
- `GET {api}/funding-service/account-statements/investor-since?provider=P` (M2773).
- Tax documents: there is only the W-8BEN form (`compliance-service/account-forms/w8ben/submit`, a write). No tax-report download was found.

**P9. IPOs, rights issues and real-estate subscriptions** [C]
- IPO data comes from asset details. `useIPO` (M4297) reads `is_ipo`, `ipo_price`, `ipo_min_shares`, `ipo_subscription_end_date`, `ipo_trading_date`, `learn_more_link`. There is no separate IPO list endpoint.
- US IPO orders exist through Alpaca, per error codes such as `ALPACA_IPO_*` (writes only).
- Rights issue subscription is Egypt only and a write (`POST market-service/orders/add-subscription-order?market=egypt`, cancel `.../cancel-subscription-order`). Noted, not documented.
- Real estate:
  - `GET {gw}/securities/v1/real-estate/subscription-progress/{securityId}` (M5837).
  - `GET {gw}/securities/v1/real-estate/bulk/subscription-progress?asset_id=…` → `items[]` keyed by `asset_id` (M5892).
  - `GET {gw}/asset/v1/metadata?asset_id=…` → `results[]{id, property_metadata{status: FAILED|LOCKED_UP|…, subscription_start_date, lockup_release_date, end_date}, extra_links[{issued_at}]}` (M5519/M5520).
  - Rent schedule: see A.4.

**P10. Gold** [C]
- `GET {api}/assets-service/assets/33633457-d544-403a-960d-a7acaaae74c1?include_feed=true&feed_detail=true` (feed with `time`).
- Gateway price: `securities/v2/price`.
- Chart: `/charts/v1/quotes/{gold}/fixed/close`.
- Legacy chart: `assets-service/charts?asset_ids={gold}&option&market` (M4299/M5755).

**P11. Notification and app settings** [C]
- `GET {api}/users-service/settings` (M2488). Default keys: `notifications`, `last_date_app_reviewed`, `restore_id`, `watchlist`, `portfolio`, `sorting_methods`, `selected_market`.
- `PATCH` with `{field, value, index}` writes the settings.

**P12. Social and engagement (low value)** [C]
- Profiles and holdings:
  - `GET {api}/users-service/users/{id}/portfolio?market=` → `portfolios` (M6561).
  - `GET {api}/users-service/users/{id}?with_details=`.
  - `GET {api}/users-service/users/{id}/trophies?page&page_count=32`.
  - `GET {api}/users-service/users/{rumble_user_id}/rumbles`.
  - `GET {api}/users-service/rumbles/{id}?market=`.
- People search: `GET {gw}/explore/v1/people/search?q&page&page_count`.
- Friends holding an asset: `GET {api}/graph-service/users/friends-own-asset[/count]?asset_id&page&page_count` (legacy `graph.*`).
- Scores and streaks:
  - `GET {gw}/v1/thndr-scores/scores` (rendered in a WebView).
  - `GET {gw}/v1/streaks/latest` and `GET {gw}/v1/streaks/intro/status`.
- "Alpha" onboarding quiz: `user-onboarding-service/alpha/*`. Skipped.

**Searched and not found** (no endpoint or fields in 12.56):
- Earnings calendar or EPS history.
- Price targets beyond Morningstar `fair_value`.
- ETF holdings or composition. ETFs have an `ETFLanding` screen with fact-sheet fields only.
- Sector pulse.
- Foreign/local market-participation flows. The only "foreigner" strings are order-rejection errors.
- A heatmap endpoint. Heatmaps are built client side from marketwatch.
- Macro data: only `EgyptMacro` i18n strings; the x.thndr.app `/api/macros` call is not in the app.
- A corporate-actions feed. "Stock Split" appears only as a wallet-activity label (see the account section).

**Clouds (savings)** [C, brief]
- Newer gateway endpoints:
  - `GET {gw}/v1/wallet-clouds/clouds` and `GET {gw}/clouds/v1/transfers?status&page&page_count`.
  - `GET {gw}/clouds/v1/transfer/{cloudId}/transactions`.
  - `GET {gw}/clouds/v1/daily-gains/yearly?year&cloud_types`.
  - `GET {gw}/clouds/v1/creation-date`.
  - `GET {gw}/v1/wallet-clouds/all-asset-stats` (yields).
  - `GET {gw}/v1/wallet-clouds/transfers/{id}/transfer-requests`.
- Legacy: `GET {api}/savings-service/clouds`.
- Markets: Egypt (EGP money-market funds) [I].
- Transfers and creation are writes, and are skipped.

---

## 5. Cross-check: every endpoint thndr-mcp uses vs the mobile app (requested section A)

thndr-mcp's calls come from `src/repositories/thndr/*.ts` (web/ThndrX-derived). "Mobile" = what app 12.56.0 calls.
Clients: web krakend = `https://prod.thndr.app/krakend-thndr-x`; mobile krakend = `https://prod.thndr.app/krakend-thndr-app`
(different gateway with different paths); `prod` = `https://prod.thndr.app`. Mobile headers on every call (M1657
`addInterceptors`): `Authorization: <headerPrefix|Bearer> <token>`, `X-DUID: <deviceId>-<uniqueId>`, `sessionId`,
`X-Language: <locale languageTag>`, `x-correlation-id: <uuid>`, `Content-Type/Accept: application/json`, optional
`user_id` (flag `mobile_add_user_id_request_header`). The mobile app sends **no** `x-thndrx-runtime-version`
(that header is a ThndrX web thing). Whether the mobile krakend (`krakend-thndr-app`) accepts the ThndrX full-access JWT
is **not provable statically** [I: same auth-service JWT, same interceptor for prod and gateway → likely yes].

Legend for "verdict": **same** = identical shape; **diff** = differences worth knowing; **better** = the app does
something thndr-mcp should copy; **web-only** = the mobile app does not call it (it stays valid for the web).

| # | thndr-mcp endpoint (what we send) | Mobile app equivalent (evidence) | Verdict / differences |
|---|---|---|---|
| 1 | `POST prod/auth-service/v2/users/email-code {email}` | same path, body `{email}` (M6464 `_sendVerificationCode`, S:946016; caller S:945714) | **same**. Registry marks the `authenticationV2` service with `headerPrefix: 'Auth'` (M4125) [C] |
| 2 | `POST prod/auth-service/v2/users/login {id, code}` | same, body `{id, code}` (M6464 `_verifyCode`, caller S:945853) | **same** (then the phone does device-key `v2/tokens/challenge` → `v2/tokens/full-access`; it never needs approval) |
| 3 | `POST prod/auth-service/tokens/request` + `GET …/{id}/status` | the phone is the **approver**: `PATCH /auth-service/tokens/request/{tokenRequestId}` body `{credentials:{firebase_token, challenge_token, response_token, pin?}}` (registry `auth.approveTokenRequest`, M6484 S:951940, M6485 S:952029) | **web-only** for create/poll; confirms our model: approval is a signed challenge from the trusted device (+ PIN) |
| 4 | `x.thndr.app/api/auth/login|logout|refresh` | none (mobile keeps tokens natively; refresh via `auth-service/v2/tokens/*`) | **web-only** |
| 5 | `GET prod/assets-service/assets/search?query&market&include_feed&feed_detail` | `GET /assets-service/assets/search?query=…&page=1&market=…&include_feed=true&feed_detail=true` (M1906, S:355261) **and** the newer `GET krakend-app/explore/v1/securities/search?query&market&page&page_count&asset_class` (M8037, S:1119224) | **diff/better**: mobile adds `page`; the explore endpoint paginates and filters **server-side by `asset_class`** (we filter FUND client-side). It returns **asset ids only** (`{count, results:[id]}`), hydrated with bulk `securities/v2/price` + `asset/v1/metadata` (§2.1) |
| 6 | `GET prod/assets-service/assets/{id}?include_feed&feed_detail` (+ `include_yearly_return`) | `GET /assets-service/assets/{id}?include_feed=true&feed_detail=true&include_yearly_return=<bool>` (M1918 `getSecurityDetail`, S:356078) with `X-Language`; plus gateway `/securities/v1/details`, `/asset/v1/metadata`, `/asset/v1/day-snapshot` (§2) | **same** for the legacy call; the gateway calls are batchable (see §2) |
| 7 | tags / constituents (from #6) | same payload | **same** |
| 8 | `GET prod/assets-service/assets/marketwatch?market=<m>` | `GET /assets-service/assets/marketwatch` with **no params**, only in `useEGMarketWatchAssets` (M1904, S:355161; query key `egyMarketWatch`, refetch 60 s when subscribed; reads `assets`, `last_updated_at`) | **diff**: the legacy marketwatch is used for **Egypt only**; the gateway has `GET krakend-app/securities/v1/marketwatch` (M8240) and batch quotes `securities/v2/price?asset_id=…` (§2, §4 A.4). Our `market=` param is harmless for egypt |
| 9 | `GET prod/assets-service/assets/market-indicators?market&page_count=100&include_feed&feed_detail` | `GET assets-service/assets/market-indicators?page_count=100&feed_detail=true&include_feed=true&include_usd_rate=true` (no `market`, M1912, S:355575); newer `GET krakend-app/explore/v1/default-market-indicators?markets=…` and `/explore/v1/user-market-indicators?market=` (M8015/M8017) | **diff/better**: `include_usd_rate=true` (adds the USD/EGP rate row); the explore endpoints give per-market default benchmarks (US/UAE) |
| 10 | `GET prod/assets-service/assets/{id}/recommendations?market&recommendations_number&include_feed&feed_detail` | same query (M1916, S:355889) | **same** |
| 11 | `GET prod/assets-service/charts?asset_ids&option&market` | same (M1880/M5461/M5620, `paramsSerializer` repeat) with `option = MOBILE_CHART_INTERVALS[i]` = `1d, 1d-1min, 1w, 1w-1h, 1M, 6M, 1y, 1y-1d, 2y, all` (M1875, S:350633) | **diff/better**: two extra options **`1w-1h`** (hourly week) and **`1y-1d`** (daily year) |
| 12 | `GET krakend-x/feed/advanced-charts/v2/{id}/trades?resolution&start_timestamp&end_timestamp` | `GET krakend-app/charts/v1/ohlc-candlesticks/{id lower}?resolution&start_timestamp&end_timestamp` (M8505, S:1157714); legacy `GET prod/assets-service/charts/candlesticks?asset_id&chart_option&market` (M5213) | **diff**: different gateway path for the same OHLC idea (§2 has resolutions/markets). Keep ours for Egypt; the mobile one is the candidate for US |
| 13 | `GET prod/assets-service/market-depth/{id}` | same, no params (M1870, S:350161) | **same** (Egypt-only feature on mobile, §2) |
| 14 | `GET prod/assets-service/market-depth/v3/trades-book/{id}?page_size&before` | `GET /assets-service/market-depth/{v2|v3}/trades-book/{id}` params `{page_size: 20, before: last_cursor, after: first_cursor}` (M3825 `useTradesHistory`; version `v3` only when flag `mobile_marketdata_trades_book_v3`, else `v2` — D:1356707ff) | **diff/better**: the app also polls **`after=<first_cursor>`** to fetch only trades newer than the head (cheap "new trades since" call) |
| 15 | `GET prod/market-service/markets/status?market&market_exchange` | same (M5677); `market` normalised `adsm→abudhabi`; `market_exchange` = feed `market_id` (egypt), **`NOPL` (us)**, **`adsm` (UAE)**; reads `is_active, market_status (OPEN/CLOSED/PRE_MARKET/POST_MARKET/UNKNOWN), next_open, next_close` | **diff/better**: we ignore `market_status`, `next_open`, `next_close` (pre/post market + next session) |
| 16 | `GET prod/market-service/markets/hours?market` | same (M1872) → `{session_open, session_close}` | **same** |
| 17 | `GET prod/market-service/accounts/wallet-and-portfolio?market` | same (M2748, S:460287); US only if profile `alpaca_id` set. Newer split: `krakend-app/wallet/v1/summary?market`, `/portfolio/v1/info?market`, `home/v1/holdings?market` (§3.1) | **same**, but for UAE use `market=abudhabi` (never `adsm`) |
| 18 | `GET krakend-x/portfolio/v1/position/{id}?market` | `GET prod/market-service/accounts/positions/{id}?market` (M2748, S:460149); list `GET prod/market-service/accounts/positions?market` | **same path exists on the mobile gateway too**: `GET krakend-app/portfolio/v1/position/{id}?market` (M5779 `getPosition`, query key `fetch-security-position`). Older screens use the market-service path; positions carry per-custodian and T0/T1 quantities (§3.2) |
| 19 | `GET prod/market-service/accounts/positions/blocked-quantities/{id}?market` | same (S:460183) | **same** |
| 20 | `GET prod/market-service/v3/orders?market&status&cursor&limit&sort_order=DESC&skip_funds=true&asset_id` | `GET market-service/v3/orders?limit&cursor&status&asset_id&market` (M3580/M6032), `status ∈ {PENDING, CANCELLED, COMPLETED, CLOSED}`, `market` `adsm→abudhabi`; response `{data, has_next, cursor}` with **`order_pairs`** (bracket stop-loss/take-profit legs) | **diff**: app sends no `sort_order`/`skip_funds`; we ignore `order_pairs`, `order_class`, `trigger_price`, `is_extended_hours_order`, `execution_type`, `time_in_force_date`. Detail: `GET market-service/orders/{id}?market` (M5573) — we have no order-detail call |
| 21 | `GET prod/market-service/realized-returns?market` | same (M2766) | **same**; newer `krakend-app/v1/portfolio-analytics/snapshots?market` (flag `mobile_return_analytics_migrate_to_api_gw`) |
| 22 | `GET prod/market-service/realized-returns/chart/{1M|6M|1Y|2Y}?market` | same path but intervals are `1d,1w,1M,6M,1y,2y,all` (M2222 `CHART_INTERVALS`); newer `krakend-app/v1/portfolio-analytics/chart/{interval}?market` | **diff/better**: we expose 4 intervals with upper-case `1Y/2Y`; the app sends **lower-case `1y`/`2y`** and also `1d`, `1w`, `all` [C path values; verify our `1Y` still works]. Returns UI exists for egypt and us only |
| 23 | `GET prod/market-service/trading-journals/full-trades` | none | **web-only** (no journal in the app) |
| 24 | `GET krakend-x/trading-journals/v1/grouped-sells`, `…/trading-metrics` | none | **web-only** |
| 25 | `GET prod/funding-service/account-activities?provider&page_size&page` | same path with **`activity_filter`** and **`asset_id`** params (M5488; `page_size` default 10); newer `GET prod/activities-service/user-activities?market=egypt|us|uae&activity_filter&page&page_size` and `GET krakend-app/wallet/v1/activities?provider&page&page_size&activity_filter&asset_id` → `{count, results}` (§3.4) | **better**: server-side filters — `activity_filter` (e.g. `DIVIDEND`, tab keys `LIMITED_FUNDING/INVESTMENT/OTHER`) and `asset_id` (per-instrument history). Providers: `EGID`, `ALPACA`, **`ADX_UAE`** (not `ALPACA_UAE`) |
| 26 | `GET/POST/PATCH/DELETE prod/users-service/watchlists` (+ `/{id}/watch-assets`, `/unwatch-assets`) | not used. Mobile: favourites `krakend-app/asset/v1/watchlist?market` (GET/PATCH `{asset_id}`/DELETE), custom lists `krakend-app/lists/v1/user-watchlists?market`, `/user-watchlists/{id}`, `lists/v1/user-lists?market`, `PATCH lists/v1/user-watchlists/securities {asset_id, watchlist_ids_to_add, watchlist_ids_to_remove}`; legacy `prod/assets-service/watchlist` | **diff**: different service. Whether `users-service/watchlists` and `lists/v1` share storage is unknown [I: likely same backend list store since both are "user watchlists"]. The mobile **bulk "toggle one asset across many lists"** call is handy |
| 27 | `GET prod/users-service/screeners?market`, `/{id}` | not used; mobile has "themes"/custom lists: `prod/assets-service/market-filters?random&page&page_count&market` / `krakend-app/v1/market-filters?…` (user filters), `GET /assets-service/market-filters/{id}?page&page_count=20&market&include_feed&feed_detail` (results), `POST /assets-service/market-filters/preview?page&page_count=20&market&include_feed&feed_detail` body = filter query (**server-side screening**), POST/PATCH/DELETE `/assets-service/market-filters[/{id}] {name, query}` | **better**: server-side screen execution (`preview`) — we emulate screening client-side over marketwatch. Query format → §4 |
| 28 | `GET krakend-x/price-alerts/v1/alerts?page&page_count&market`, `/asset-alerts/{id}`, `POST`, `DELETE` | `GET prod/price-alerts-service/price-alerts?page&page_count` (no market), `GET …/price-alerts/assets/{id}?page&page_count`, `POST prod/price-alerts-service/price-alerts {asset_id, price|null, percentage|null, direction UP|DOWN, frequency ONE_TIME|RECURRING, notes, market}`, **`PATCH {price-alerts-service|assets-service}/price-alerts/{id} {alertId, notes}`**, `DELETE …/{id}` (M6052/M5377/M5925/M4376/M5906); the mobile gateway also has `GET krakend-app/price-alerts/v1/asset-alerts/{id}?page&page_count` (M8500) | **better**: alerts can be **percentage-based** (`percentage` instead of `price`) and carry **`notes`** editable via PATCH (flag `mobile_securities_price_alert_notes`). No pause/enable endpoint found. Market for UAE = `abudhabi` |
| 29 | `GET krakend-x/notifications/v1?page&page_count`, `/has-unread`, `PATCH /batch?field=is_read`, `/read-all` | `GET prod/notifications-service/notifications?page&page_count=15`, `GET …/notifications/count`, `PATCH …/notifications/{id}?field=is_read`, `PATCH …/notifications/batch?field=is_read` (M2473/M2482/M2475/M2466); `field` also `is_dismissed` | **diff**: same backend via prod; mobile gets an unread **count** (not just a flag) and can **dismiss** (`field=is_dismissed`); no read-all on mobile |
| 30 | `GET krakend-x/savings/v1/clouds`, `/clouds-stats` | `GET prod/savings-service/clouds` (`total_amount, total_gain, amounts_per_type`), `krakend-app/v1/wallet-clouds/clouds`, `/v1/wallet-clouds/all-asset-stats` (`currently_earning`), `clouds/v1/transfers`, `clouds/v1/transfer/{id}/transactions`, `clouds/v1/daily-gains/yearly?year&cloud_type`, `clouds/v1/creation-date` (§3.10) | **diff/better**: per-cloud transaction history and **daily gains by year** are available; Egypt only |
| 31 | `GET prod/api/post/news/?asset_id&locale&page` | same path via registry `feedV2.getNews` with payload `{page, asset_id, locale, markets}` (M6532, S:958916; M1881) — **`markets` filter**; newer `krakend-app/news/v1/market`, `news/v1/asset`, `explore/v1/news/articles`, `explore/v1/news/sources` (§2) | **better**: `markets` param; the app now uses `krakend-app/news/v1/market?markets=us&asset_id…` for **US** and `krakend-app/explore/v1/news/articles` (filters: source, category, sentiment, asset_id, scope, search, from_date, to_date) for every other market (§2.6) |
| 32 | `GET x.thndr.app/api/financials?symbols&mode` | none on mobile. Mobile research: registry `GET prod/assets-service/analysis/financial/{assetId}`, `/analysis/consensus/{assetId}` (only when asset `has_consensus`), `/analysis/technical/{assetId}` (M6598 → M4124 `parseUrl`) | **web-only**; the mobile `analysis/*` endpoints are an alternative source (legacy code path; shapes in §2/§4) |
| 33 | `GET x.thndr.app/api/macros` | none | **web-only** |

### 5.1 Things the app does better (actionable for thndr-mcp)

1. **Server-side activity filters** (`activity_filter`, `asset_id`) on account activities — enables "dividends received
   for COMI" without paging everything (#25).
2. **Server-side screening** via `POST /assets-service/market-filters/preview` (#27) and paginated, `asset_class`-filtered
   search via `/explore/v1/securities/search` (#5).
3. **Market status detail**: `market_status` (pre/post-market) + `next_open`/`next_close` (#15); US uses `market_exchange=NOPL`, UAE `adsm`.
4. **Chart options** `1w-1h` and `1y-1d` (#11); returns-chart intervals `1d/1w/all` (#22).
5. **Trades-book incremental polling** with `after=<first_cursor>` (#14).
6. **Price alerts**: percentage alerts and notes (+ PATCH to edit notes) (#28). No pause/resume exists in the app.
7. **Notifications**: unread `count`, `is_dismissed` (#29).
8. **News `markets` filter** (#31) and per-market default indicators with `include_usd_rate=true` (#9).
9. **Order detail** `GET market-service/orders/{id}?market` and bracket legs `order_pairs` (#20).
10. **UAE**: always `market=abudhabi` for account/status/alerts/orders; `provider=ADX_UAE` for activities; `adsm` only on instrument data.

---

## 6. Write operations (documented, not implemented — ADR 0006)

thndr-mcp stays read-only for money. This section only documents what the app sends, so that a future ADR can decide.
Clients: **thndrApi** = `https://prod.thndr.app/` · **apiGateway** = `https://prod.thndr.app/krakend-thndr-app` (both:
`Authorization: Bearer <full-access token>`, `X-DUID`, `sessionId`, `X-Language`, `x-correlation-id`; see transport
section). Evidence is `Mxxxx` (module) and `S:line` (simplified.js). [C] = read in code, [I] = inferred.

### W.0 Safety mechanisms (what protects a write) 

| mechanism | where | notes |
|---|---|---|
| **Client idempotency key** `idempotent_id` | every order submit (stock, US IPO, fund, mf-order, gold/real-estate, recurring) [C] | Generated per review screen: `generateUUID()` = uuid v4 whose last 12 chars are replaced by `Date.now().toString().slice(1,13)` (M8371 `embedTimestampInUUID`, S:1144909; flag `mobile_orders_add_time_stamp_to_uuid`). Server rejects replays with `DUPLICATE_ORDER_ID` / `DUPLICATE_REQUEST` (enums M3575, M8372) [C]. Not used for funding, Clouds, watchlists, alerts. |
| `source: "MOBILE"` | all order bodies, watchlist create [C] | ThndrX sends `source: "thndrx"`. |
| Review / confirm screen | orders (`orders.review.title`, `OrderReview` route), withdrawals (`…withdrawalAmount.totalAmountButton.confirm`), chart order drag (`charts.dropdown.tradingview.editOrder.reviewTitle`) [C] | UI only; the API has no confirmation token. Optional "market order delay" prompt (flag `mobile_orders_market_orders_delay_prompt`) and stop-loss disclaimer [C]. |
| PIN / biometrics | **app unlock only** (`AccessRoutes.EnterPin`, `ENTER_PIN_REAUTHENTICATE`, M1202 S:232561) [C] | No per-order or per-withdrawal PIN, OTP or signature was found [I: searched OTP/pin/signature/biometric strings; OTP exists only in login, phone change, T&C acceptance and Thndr Pay cards]. The device key + `auth-service/v2/tokens/challenge` is part of login (auth section), not of each write. |
| Token scopes | legacy registry (M4125/M4127, S:670138) lists `application-write-token`, `$simulator-write:privileged$-token`, scopes `order:write`, `funding:write`, `market_egypt:write`… [C] | **Vestigial**: `getAuthorizationHeader` always sends `<prefix> <APP_TOKEN>` (one full-access JWT); the scope name only picks the header prefix (`Bearer`/`Auth`) and the `$simulator-…$` variant when the simulator is on [C]. In practice any full-access token can write. |
| Phone verification | withdrawals / fund orders fail with `PHONE_NUMBER_UNVERIFIED` (M8372) [C] | Withdrawals only go to a pre-registered bank account / e-wallet (`user_bank_account_id`). |
| Feature/eligibility gates | `ORDERS_MARKET_CONFIG` (M3637), unleash flags, `requires_trader_subscription` (EGX advanced orders need a paid plan unless `mobile_orders_remove_*_subscription_guard`) [C] | Server enforces too (`NOT_ALLOWED_TO_PLACE_ORDER`, `REQUIRED_SCOPE_NOT_FOUND`, `MARKET_IS_CLOSED`…). |
| KrakenD error-in-200 | gateway writes return `{error_<section>: {...}}` (`error_submit_order`, `error_edit_order`, `error_edit_order_pair`, `error_cancel_stop_order`, `error_create_watchlist`, `error_clouds_transfer`…); parsed by `extractErrorCodeAndDetails` (M1738) — every key starting with `error_`; `x-krakend-completed: "true"` header marks a complete response [C] | Same pattern as ThndrX's `M.p4`. |

### W.1 Per-market order capabilities — `ORDERS_MARKET_CONFIG` (M3637, D:1256090) [C]

Evaluated symbolically from the module's constant table (a one-off helper, not committed). Keys are `MarketName`
values (`abudhabi` = UAE/ADX; `adsm` is mapped to `abudhabi` before order calls).

| feature | egypt | us | abudhabi (UAE) | simulator |
|---|---|---|---|---|
| market order / limit order | yes / yes | yes / yes | yes / yes | yes / yes |
| limit-order expiry (time in force) | yes | yes | yes | no |
| advanced limit order (TIF + execution type) | yes | yes | flag `mobile_orders_adx_expiry` | no |
| allowed TIF for advanced limit | day, date, gtc, ioc, fok | day, gtc, ioc, fok | day, date, gtc, ioc, fok | — |
| execution type (AON / min-fill) | yes | no | yes (AON flag `mobile_orders_enable_adx_aon_execution_type`) | no |
| stop-loss (stop) order | yes | yes | flag `mobile_orders_adx_stop_loss` | no |
| stop-loss TIF | day, date, gtc | day, gtc | day, date, gtc | — |
| settlement choice (`T0`/`T1`/`SETTLED`) | T0, T1, SETTLED | SETTLED only | SETTLED only | SETTLED |
| default TIF for "date" field | `date` | `gtc` | `gtc` | `date` |
| notional (cash amount) orders / fractional shares | no / no | yes / yes (`is_fractional`, 9-dp units flag) | no / no | no |
| extended-hours trading | no | yes (+ flag `mobile_orders_enable_extended_hours_trading`) | no | no |
| place order outside market hours (queued) | yes (flag `mobile_orders_place_outside_market_hours`) | no | no | no |
| edit order / edit shares | yes / flag `mobile_orders_eg_allow_edit_t0` | yes / yes | yes / no | no |
| recurring orders | yes | yes | no | no |
| IPO order / rights order | yes / yes | (US IPO via notional, see W.2) / no | no / no | no |
| block trading, T+2 breakdown | yes | no | no | no |
| price-step check | no | no | flag `mobile_orders_adx_price_steps` | no |
| sellable-units field | `qty_settled` | `qty_available` | `qty_settled` | `qty` |
| requires trader subscription | yes | no | no | no |
| currency | EGP | USD | AED | EGP |

Other order flags [C]: `mobile_orders_can_submit_stop_loss`, `mobile_orders_edit_stop_loss`,
`mobile_orders_bracket_trading_experience`, `mobile_orders_stop_loss_persistent_t0_t1`,
`mobile_orders_alo_persistent_t0_t1` (→ `is_persistent: true`), `mobile_orders_disable_t0`, `mobile_orders_disable_t1`,
`mobile_orders_trading_blocked`, `mobile_orders_disable_azg_buy_orders`, `mobile_orders_disable_ftns_buy`,
`mobile_orders_disable_market_order_no_price_limit`, `mobile_orders_recurring_order_funds`,
`mobile_orders_use_qty_available_in_us`, `mobile_securities_gold_fund_trading_actions`, `mobile_securities_ipo_revamp`.

Enums (M3575, S:~557000 region; D:1239120) [C]:
`OrderType` BUY | SELL | SUBSCRIPTION · `AssetClass` STOCK | FUND · `Custodian` THN | AUB (EGX custodians) ·
`TimeInForce` day | date | gtc | ioc | fok · `ExecutionType` DEFAULT | ALL_OR_NONE | MINIMUM_FILL | NO_FILL ·
`OrderSettlement` T0 | T1 | SETTLED · `OrderFrequency` DAILY | WEEKLY | MONTHLY · `OrderClass` Bracket | StopOrder |
TakeProfit · `OrderPairStatus` Inactive | Active | Cancelled | Triggered · `RightSubscriptionStatus` disabled |
tranche_1 | tranche_2 · `MutualFund` MTF, AZG, AZO, AZS, NMF, BSC, CI30 · `FeesCalculatorType` STOCK | FUND | IPO | RIGHTS ·
rejection reasons (`ORDER_REJECTION_REASONS`: OVER/UNDER_PRICE_RANGE, DISCOVERY_SESSION_MARKET_ORDER,
FOREIGNERS_OWNERSHIP_LIMIT_EXCEEDED, …) and `ORDER_ERROR` (INSUFFICIENT_FUNDS, MARKET_IS_CLOSED, EGID_ERROR,
MARKET_IN_PRE_CLOSE_AUCTION, STOCK_TRADING_NOT_ALLOWED_FOR_FOREIGNERS, …).

### W.2 Place an order — `POST thndrApi /market-service/orders?market=<market>` [C]

`submitOrder` in M6256 (S:914038; duplicate copy M5245) — used for stocks in **all markets** (egypt, us, abudhabi,
simulator). Body depends on the asset (raw D:2228762):

```jsonc
// STOCK (EGX / US / ADX / simulator)
{ "idempotent_id": "<uuid>", "asset_id": "<uuid>", "stock_id": "<symbol>",
  "amount": <units>,            // shares (US may be fractional)
  "price": <limit or ref price>, "is_limit": <bool>,
  "order_type": "BUY" | "SELL" | "SUBSCRIPTION",   // SUBSCRIPTION = EGX IPO subscription
  "is_extended_hours_order": <bool>,               // US only
  "source": "MOBILE",
  "custodian": "THN" | "AUB",                      // only on SELL (EGX)
  "settlement": "T0" | "T1" | "SETTLED",           // EGX choice
  "time_in_force": "day|date|gtc|ioc|fok", "time_in_force_date": "<date>",
  "notional": <cash amount>,                       // US cash orders
  "is_right": <bool>,                              // EGX rights
  "trigger_price": <price>,                        // stop(-loss) order
  "execution_type": "DEFAULT|ALL_OR_NONE|MINIMUM_FILL|NO_FILL", "minimum_fill_volume": <units>,
  "is_persistent": true }                          // persistent stop/advanced-limit across T0/T1 (flags)
// FUND (EGX mutual fund)
{ "idempotent_id", "asset_id", "asset_class": "FUND", "amount_to_invest": <cash>, "is_limit": false,
  "order_type": "BUY" | "SELL", "source": "MOBILE", "redeem_all": false }
// US IPO (isUSIPO = market === "us" && order_type SUBSCRIPTION)
{ "idempotent_id", "asset_id", "asset_class", "notional": <cash>, "is_limit": false, "order_type", "source": "MOBILE" }
```
Response: the created order (read via the orders list afterwards; on success the app invalidates pending orders,
position, blocked quantity and the orders list) [C]. Error: `response.data.detail.type` (one of `ORDER_ERROR`) [C].
EGX SELL split: `useOrderSplit` (M6267, S:915403) builds **two** SELL orders, one per custodian (AUB then THN), when
the user's shares are held at both [C].

Other placement endpoints:

| flow | request | body | notes |
|---|---|---|---|
| Gold fund / real-estate fund (EGX) | `POST apiGateway /orders/v1/submit-order?market=egypt` (M8370 `submitOrder`, S:1144909) [C] | `{asset_id, idempotent_id, asset_class:"FUND", amount_to_invest, amount /*grams*/, order_type, is_limit, source:"MOBILE"}` | response `normalizeOrderDates(data)`; errors `error_submit_order` / `FUND_ORDER_SUBMISSION_ERROR_TYPES` (INVALID_AMOUNT_TO_INVEST, FUND_EXCEEDED_MAX_CAPACITY, NOT_ELIGIBLE_FOR_MARKET, …) |
| Mutual fund (new flow) | `POST apiGateway /v1/orders/mf-order?market=<m>` (M3581 `useMutualFundOrderSubmit`, S:553184) [C] | `{idempotent_id, asset_id, asset_class, amount_to_invest, is_limit:false, order_type, source:"MOBILE"}` | redemption = `order_type: SELL` |
| Rights subscription (EGX) | `POST thndrApi /market-service/orders/add-subscription-order?market=egypt` (M6269 `useSubscribeRights`, S:915622) [C] | `{asset_id, amount, is_limit:false, order_type:"BUY"}` | cancel: `PATCH /market-service/orders/{order_id}/cancel-subscription-order?market=egypt` (M6321 `cancelRightsSubscription`) |
| Recurring order (egypt, us) | `POST thndrApi market-service/recurring-orders` (M6331 `useSubmitRecurringOrder`, S:923512) [C] | `{asset_id, asset_class, frequency:"DAILY|WEEKLY|MONTHLY", market, amount_to_invest, price, idempotent_id, units, stock_id, source:"MOBILE"}` | cancel: `PATCH market-service/orders/recurring-configs/{configId}/cancel?market=<m>` (M6316) |
| Re-activate a suspended order | `PATCH thndrApi /market-service/orders/{order_id}/activate?market=<m>&symbol_code=<code>` (M6358, S:926821) [C] | none | errors `activateOrderMarketHoursClosed`, `activateOrderOrderNotSuspended` |

### W.3 Pre-trade calculators (no state change, but order-entry only)

| endpoint | body / params | response fields read |
|---|---|---|
| `POST thndrApi market-service/orders/max-cash-and-units?market=<m>` (M5241-area `calculateMaxAllowedCashAndUnits`, D:1950341) [C] | `{unit_price, order_type, is_limit, is_subscription, custodian, is_fractional, asset_id, previous_order?: {limit_price, amount, total_fees}}` (`previous_order` when editing) | `max_cash`, `max_units`, `safety_buffer`, `thndr_fees`, `third_party_fees`, `total_fees` |
| `POST apiGateway /orders/v1/max-cash-and-units?market=<m>` (M8376, S:1145146; gold) [C] | `{asset_id, order_type, unit_price, is_limit, is_subscription, is_fractional, custodian}` | same; error key `error_get_max_cash_and_units` |
| `POST thndrApi market-service/orders/calculate-fees` + `?market=` as axios param (M5255/M6266 `postCalculateFees`, S:817297) [C] | `{amount, unit_price, order_type, is_limit, is_subscription, custodian, asset_id}` | `total_fees`, `thndr_fees`, `third_party_fees`, `fees_amount`, `amount_without_fees`, `estimated_fees`, `order_fees`, `subscription_fees`, `redemption_fees` |
| `POST apiGateway /v1/orders/calculate-fees?market=<m>` (M8368, S:1144811; M7190) [C] | same body | same; `error_calculate_fees` |

### W.4 Edit an order

| endpoint | body | notes |
|---|---|---|
| `PATCH thndrApi market-service/orders/{orderId}/edit?market=<m>` (M6268 `editOrder`, S:915504; D:2231901) [C] | `{amount, price}` or `{amount, trigger_price}` (key `trigger_price` when editing a stop order) | `market` `adsm` is rewritten to `abudhabi`. Legacy copy M5242: `{amount, price}` with `?market=<marketName>` |
| `PATCH apiGateway /orders/v1/{order_id}/edit?market=<m>` (M8487, S:1155567) [C] | `{amount, price | trigger_price, pairs?}` | TradingView chart drag ("modify chart order price", M8486); response `normalizeOrderDates(data)`, error `error_edit_order` |
| `POST apiGateway /orders/v1/stop-orders/{pair_id}/edit-pair?market=<m>` (M8488 `editOrderPair`, S:1155654) [C] | `{take_profit: {trigger_price, limit_price?}|null, stop_loss: {…}|null}` | edits a **bracket** (take-profit/stop-loss pair attached to an order: `order.order_pairs[].{pair_id, stop_loss, take_profit}` each `{id, status, type: Limit|Market, trigger_price, limit_price, qty}`); error `error_edit_order_pair`. Creation of brackets was not found in the app [I: only display/edit/cancel]. |

### W.5 Cancel

| endpoint | notes |
|---|---|
| `PATCH thndrApi /market-service/orders/{order_id}/cancel?market=<m>[&symbol_code=<code>]` (M6321 `cancelBuySellOrder`, S:922850) [C] | no body; `symbol_code` added for commodity (gold) assets |
| `PATCH apiGateway /orders/v1/{orderId}/cancel?market=<m>` (M8389 `cancelOrder`, S:1146338) [C] | fund/gold orders; errors `ORDER_NOT_FOUND`, `ORDER_NOT_CANCELABLE` |
| `PATCH thndrApi /market-service/stop-orders/{order_id}/cancel?market=<m>` (M6345 `useCancelStopOrder`, S:924557) [C] | stop-loss order |
| `PATCH apiGateway /orders/v1/stop-orders/{stop_order_id}/cancel?market=<m>` (M8492, S:1156270) [C] | stop order / bracket leg; error `error_cancel_stop_order` |
| `PATCH …/cancel-subscription-order`, `…/recurring-configs/{id}/cancel` | see W.2 |

### W.6 Funding (deposits, withdrawals, bank accounts) — money movement

Provider per market (M534 maps, evaluated) [C]: `MARKET_PROVIDER_MAP` egypt→`EGID`, us→`ALPACA`, abudhabi→`ADX_UAE`,
simulator→`THNDR`; **funding requests** use `MARKET_PROVIDER_FUNDING_REQUESTS_MAP` egypt→`EGID`, us→**`ALPACA_UAE`**,
abudhabi→`ADX_UAE` (the wallet effect also forces `funding_provider = ALPACA_UAE` when market is `us`, S:964795).
`MARKET_CURRENCY_MAP` egypt EGP, us USD, abudhabi AED, simulator THNDR.

| flow | request | body |
|---|---|---|
| Deposit / withdrawal request | `POST thndrApi funding-service/funding-requests` (M6568 `_createFundingRequest`, M2618 `postCreateFundingRequest`, S:444884) [C] | fund form `{amount, currency, deposit_date, transfer_type, funding_provider, side: "DEPOSIT"|"WITHDRAW", user_bank_account_id, transaction_ref, is_instant?}` (initial state S:964540); card top-ups add `billing_details: {country, city, address_line, …}` and get back `checkout_session` (opened in a Checkout.com web view, M6426) |
| `transfer_type` values | | `BANK_DEPOSIT`, `BANK_WIRE_TRANSFER`, `FAWRY_REF_NUMBER`, `EWALLET_DEPOSIT`, `WALLET_TRANSFER` (e-wallet withdraw), `INSTAPAY_TRANSFER`, `IPN_COLLECTPLUS` (immediate InstaPay), `DEBIT_CARD`, `CARD`, `APPLE_PAY`, `GOOGLE_PAY`, `SWEEP_ACCOUNT` |
| Top-up methods per market | | EG: debit card, bank, e-wallet, InstaPay, immediate InstaPay · US: US bank (wire), card, Apple/Google Pay (Checkout.com) · ADX: bank, card, Apple/Google Pay (flags `mobile_wallet_adx_*_top_up`, `mobile_wallet_us_checkout_*`, `mobile_wallet_checkout_{us,adx}_disabled`, `mobile_wallet_maintenance_{egypt,us,adx}`, `mobile_wallet_disable_funding`) |
| Funding fee estimate | `POST apiGateway /v1/wallet-funding/funding-requests/calculate-fees` (M2737) [C] | `{amount, transfer_type, funding_provider, side}` |
| Instant settlement (EGX) | `POST apiGateway /v1/wallet-funding/instant-settlement-request?market=<m>` body `{}` (M3325) [C] | flag `mobile_wallet_instant_settlement_eg`; read side: `GET /v1/wallet-funding/estimate-settlement-details?market=` |
| Cancel withdrawal | `POST thndrApi funding-service/funding-requests/withdrawals/{id}/cancel` (M3484) · `POST apiGateway wallet/v1/withdrawal/{requestId}/cancel` (M7960) [C] | |
| Cancel deposit | `POST apiGateway wallet/v1/deposit/{requestId}/cancel` (M3485, M7959; flag `mobile_wallet_cancel_deposit_requests`) [C] | |
| Cancel all pending | `PATCH thndrApi funding-service/funding-requests/cancel/pending` (M2774) [C] | |
| Bank accounts | `POST thndrApi funding-service/v2/user-bank-account` `{…bankDetails, provider}` (M3388) · `DELETE funding-service/user-bank-account/{id}` (M6568) · `PATCH funding-service/v2/user-bank-account/{bank_account_id}/set-dividend-account` (M3365) [C] | |
| Subscriptions (paid plans) | `POST thndrApi payment-service/v2/subscriptions/cancel-all?market=<m>` (M2775) · `POST payment-service/v2/subscriptions/{id}/renew` (M3614, error `INSUFFICIENT_FUNDS`) [C] | charges the wallet |
| Also present (not detailed) | gift cards `transfers-service/gift-cards` (send/accept/reject/validate), Thndr Pay cards `pay.thndr.app/api/v1/thndr-pay/*` (OTP + PIN protected: `send-otp`, `verify-otp`, `login-pin`, `validate-pin`, `freeze`, `transfers`) [C] | |

### W.7 Savings — "Clouds" (EGP savings funds)

Enums (M2799) [C]: `CloudType` `MONTHLY_EGP` | `INSTANT_EGP` (+ Shariaa cloud behind `mobile_clouds_shariaa_cloud`);
direction `IN` | `OUT`; `TransferType` `INSTANT` | `SCHEDULED` | `SCHEDULED_CLOUD_FULL_EXIT`; status COMPLETED | PENDING |
PROCESSING | CANCELLED | FAILED. Three generations of endpoints coexist:

| action | legacy thndrApi `savings-service` | gateway `clouds/v1` | gateway `v1/wallet-clouds` |
|---|---|---|---|
| create | `POST savings-service/clouds` `{name, icon, goal_amount, goal_date, cloud_type}` (M2820) | `POST /clouds/v1/create-cloud` `{name, icon, cloud_type, goal_amount, goal_date}` (M7893) | — |
| edit | `PATCH savings-service/clouds/{id}` `{goal_amount, goal_date, icon, name}` (M2892) | `PATCH clouds/v1/{cloudId}` `{name, goal_amount, goal_date}` (M7939) | — |
| delete | `DELETE savings-service/clouds/{cloudId}` (M2886) | `DELETE clouds/v1/{cloudId}` (M7941) | — |
| wallet ⇄ cloud transfer | `POST savings-service/clouds/external-transfer` `{direction, cloud_id, is_scheduled, amount?, transfer_type?, is_max_amount?}` (M2801) | `POST /clouds/v1/transfer` `{cloud_id, direction, transfer_type, amount, is_max_amount}` (M7894) | — |
| cloud ⇄ cloud | `POST savings-service/clouds/internal-transfer` `{amount, source_cloud_id, destination_cloud_id, is_max_amount?}` (M3131) | — | — |
| fee estimate | — | `POST /clouds/v1/transfer/calculate-fees` `{cloud_id, direction, transfer_type, amount, …}` (M7909) | `POST /v1/wallet-clouds/transfers/calculate-fees` `{cloud_id, amount, direction, is_scheduled}` (M3146) |
| cancel scheduled transfer | — | `PATCH /clouds/v1/transfer/{transferRequestId}` `{status:"CANCELLED"}` (M7447) | `PATCH /v1/wallet-clouds/transfer-requests/{id}` `{status:"CANCELLED"}` (M2875) |

All [C]. Egypt only (EGP) [I: no market param, EGP enums].

### W.8 Lists, alerts, screeners, preferences (thndr-mcp already implements some via ThndrX endpoints — cross-check)

| feature | mobile request | vs thndr-mcp (ThndrX) |
|---|---|---|
| Create watchlist | `POST apiGateway lists/v1/user-watchlists` `{market, source:"MOBILE", name, asset_ids, icon, color}` → `{id}`; error `error_create_watchlist` (M8193, S:1132159) [C] | we use `POST /users-service/watchlists {name, market, source:"thndrx", asset_ids}` |
| Edit watchlist | `PATCH apiGateway lists/v1/user-watchlists/{watchlistId}` with a partial payload (`name`, `icon`, `color`, `asset_ids` [I]) (M8266) [C] | we `PATCH /users-service/watchlists/{id} {name}` |
| Delete watchlist | `DELETE apiGateway lists/v1/user-watchlists/{watchlistId}` (M8268) [C] | same semantics, different service |
| Add/remove one asset across many lists | `PATCH apiGateway lists/v1/user-watchlists/securities` `{asset_id, watchlist_ids_to_add[], watchlist_ids_to_remove[]}` (M5419, S:831050) [C] | we call `watch-assets` / `unwatch-assets` per list |
| Default "favourites" list | `PATCH apiGateway /asset/v1/watchlist {asset_id}` / `DELETE … {data:{asset_id}}` (M5763); legacy `PATCH/DELETE thndrApi /assets-service/watchlist {asset_id}` (M4426/M4427) [C] | not implemented |
| Create price alert | `POST thndrApi /price-alerts-service/price-alerts` `{asset_id, price | percentage, direction:"UP"|"DOWN", frequency:"ONE_TIME"|"RECURRING", notes, market}` (M5927, S:879838; body built ~S:879600) [C] | we `POST krakend-thndr-x /price-alerts/v1/alerts {asset_id, price, frequency, direction, market}` — mobile adds **percentage alerts** and **notes** |
| Delete alert | `DELETE thndrApi /price-alerts-service/price-alerts/{id}` (M5906); legacy `DELETE /assets-service/price-alerts` [C] | we use krakend `/price-alerts/v1/alerts/{id}` |
| Edit alert notes | `PATCH thndrApi /{assets-service|price-alerts-service}/price-alerts/{alertId}` `{alertId, notes}` (M4376 `updatePriceAlert`, S:695067; default `assets-service`, `price-alerts-service` when `ShouldUsePriceAlertsService`) [C] | not implemented. No pause/resume or price edit endpoint found [I]. |
| Which alert service per market | `ShouldUsePriceAlertsService` (M3563 config): egypt = flag `mobile_securities_eg_use_price_alerts_se…`, us = flag `mobile_securities_use_price_alerts_servi…`, abudhabi = true, simulator = true; alerts shown for egypt, us, abudhabi (flag `mobile_securities_adx_price_alerts`) [C] | |
| Screener / theme ("market filter") | `POST thndrApi /assets-service/market-filters {name, query}` (M1924) · `PATCH /assets-service/market-filters/{listId} {name, query}` (M1867) · `DELETE /assets-service/market-filters/{listId}` (M1866) · preview `POST /assets-service/market-filters/preview?page=&page_count=20&market=&include_feed=true&feed_detail=true` body = `query` (M1873) [C] | we read `/users-service/screeners`; mobile uses market-filters (custom screeners need a paid plan, string S:69219) |
| Market-indicator (index ticker) prefs | `PUT thndrApi /assets-service/user-market-indicators?feed_detail=true&include_feed=true {assets_ids}` (M1922) · `PUT apiGateway /explore/v1/user-market-indicators {market, indicators}` (M8155) [C] | not implemented |
| Notifications read | `PATCH thndrApi notifications-service/notifications/batch?field=is_read` body = list (M2466) · `PATCH notifications-service/notifications/{id}?field=is_read` (M2475); `field` ∈ `is_read`, `is_dismissed` [C] | we use krakend `/notifications/v1/batch?field=is_read` and `/read-all` |
| User settings | `PATCH thndrApi users-service/settings {field, value, index?}` (M2488); fields include `notifications.<key>`, `selected_market`, `watchlist`, `portfolio`, `sorting_methods`, `last_date_app_reviewed`, `restore_id` [C] | notification preferences live here |
| Profile | `POST/PATCH thndrApi users-service/users` (M6560), `POST users-service/users/profile_picture/upload|delete`, legacy `PATCH /api/user` with `Auth` prefix (M6609), `PATCH auth-service/v2/users`, follows `POST/DELETE users-service/follows`, notify-me [C] | not implemented |
| TradingView storage (gateway) | `POST /tradingview/v1/layouts {layout}` · `PATCH /tradingview/v1/layouts/{id} {layout}` · `DELETE …/layouts/{id}` · `POST /tradingview/v1/drawings/{assetId} {drawings:{sources, groups,…}}` · `DELETE …/drawings/{assetId}` · `PUT /tradingview/v1/drawing-templates {tool_name, template_name, content}` · `DELETE …/drawing-templates/{id}` · `PUT /tradingview/v1/indicator-defaults {indicator, default_setting}` · `DELETE …/indicator-defaults?indicator=` (M8516–M8546) [C] | ThndrX uses `/tvcharts/v1/*` |

### W.9 Notes for any future write support
- The `market` query value for orders is the selected market (`egypt`, `us`, `abudhabi`, `simulator`); `adsm` must be
  mapped to `abudhabi` (edit flow does it explicitly) [C].
- Always generate a fresh `idempotent_id` per user-confirmed order and reuse it on retry; the server de-duplicates [C/I].
- No step-up auth exists server-side for orders or withdrawals beyond the full-access token [I] — an MCP write tool
  would be the only confirmation layer, which is exactly why ADR 0006 keeps them out.

---

## 7. Open questions, conflicts and caveats

- **Token reuse on the mobile gateway** [I]: the app sends the same full-access JWT to `prod.thndr.app/<service>` and to
  `prod.thndr.app/krakend-thndr-app/<path>`. Nothing in the bundle shows `krakend-thndr-app` checking anything extra.
  Still, accepting a ThndrX-minted token (and the absence of `x-thndrx-runtime-version`) must be checked with one live
  call before relying on it. Device headers (`X-DUID`, `sessionId`) are always sent by the app; a server may require them.
- **Watchlist storage**: whether `users-service/watchlists` (web) and `lists/v1/user-watchlists` (mobile) are the same
  store is unknown. The `market` value the app uses for UAE lists (`abudhabi` or `adsm`) is unconfirmed.
- **Tag ids** (M3563 S:551678-551679): `themeIconMap = {205:'t_zero', 157:'islamic_star', 185:'bank_slash'}`, but the
  bottom-sheet map has 205 → same-day tradable, **185 → Sharia**, **157 → OTC** (by key order). The two maps point
  opposite ways for 157/185, so treat the names as unresolved [I].
- **Legacy registry endpoints** (`assets-service/analysis/*`, `assets/top_performers`, `accounts/portfolio`,
  `accounts/summary`, `/api/post/news`): the code is still compiled and some Overmind effects call it. Whether the
  current UI reaches them, and for which markets they return data, is unknown [I].
- **US realtime**: the app has no RTDB path for US prices and computes `is_delayed=true` for US charts. US quotes are
  therefore delayed (likely 15 min) [I].
- **Time zones**: Egypt `Africa/Cairo` and ADX `Asia/Dubai` are in code. The US has no time-zone constant; New York time
  is assumed server side [I].
- **Simplifier caveat**: `simplified.js` can drop a register's default value set before a branch. Every flag-dependent
  default cited in this report was re-checked in `decompiled.js`: trades-book `v2`/`v3`, alert prefix
  `assets-service`/`price-alerts-service`, the `market_exchange` map, the `AVAILABLE_EGYPT` default, the `adsm`↔`abudhabi`
  maps for indicators and Thndr-lists, and the activities page size 10.
- **Artifacts** (regenerated under `.cache/thndr-mobile/<version>/decompiled/` by the skill, not committed):
  `decompiled.js`, `simplified.js`, `strings.tsv`, `calls.tsv`, `modules.tsv`. The flag list (267 Unleash flags), the
  service registry and the order config were one-off extractions.
