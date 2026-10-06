# 0021. Support every Thndr market, with per-market capabilities

- Status: Accepted
- Date: 2026-10-06

## Context

thndr-mcp was built from the ThndrX web bundle, which only serves Egypt. The Android app (analysed in
[docs/api/mobile-app.md](../api/mobile-app.md)) and live read-only checks with a real account (2026-10-06) show that
Thndr serves four markets and that each offers a different set of features:

- `compliance-service/eligibilities/v2/visible-markets` lists the user's markets: `egypt`, `us`, `abudhabi`,
  `simulator` (here none restricted).
- The UAE market has two wire codes: `adsm` for instrument data (search, details, charts) and `abudhabi` for account
  data (wallet, orders, alerts, watchlists, market status with `market_exchange=adsm`). The mobile gateway's search
  takes `abudhabi`.
- Market status needs `market_exchange`: the asset's board for Egypt (`NOPL` by default), `NOPL` for the US, `adsm`
  for the UAE. Without it Thndr answers 422 — our `get_market_status` was broken for every market.
- Only Egypt has the marketwatch snapshot (400 "not supported" elsewhere), OHLC candles (empty for US/UAE), order
  book and trades book (403 FEATURE_DISABLED for US/UAE), financials (404 for US/UAE symbols), indices with
  constituents, savings (Clouds) and the full trading journal (422 for the US).
- Every market has bulk quotes through the mobile gateway (`krakend-thndr-app/securities/v2/price`, which accepts our
  token), closing-price history (`assets-service/charts`), orders and a wallet. Watchlists work for egypt, us and uae;
  price alerts for egypt and us (the UAE answers 403); news for egypt and us (empty for UAE listings seen).
- Gainers/losers (`assets-service/assets/rank`) work for Egypt and the US (500 for the UAE).
- Activity providers differ per market: `EGID`, `ALPACA`, `ADX_UAE`; the simulator has no activity feed (Thndr
  answers 422 for `THNDR`, the provider the app lists).
- The simulator is a paper account (`market_name` "boom_sim"): wallet and orders work; market status has nulls,
  hours answer 422; it trades Egypt's (and US) listings, so its market data follows the instrument (Egypt's snapshot
  for Egyptian listings).
- Two entries of the feature table rest on thin evidence and should be re-checked with a funded account: `journal` is
  Egypt-only (the US full-trades answer 422; UAE grouped-sells answered 200 but empty, and trading-metrics has no market
  parameter), and `returns` is enabled for the UAE although the app hides Returns for ADX (the only evidence is a 404
  on an empty account, which we read as an empty history).

## Decision

- **Markets** in the domain (shared kernel): `egypt` (EGX, EGP, Africa/Cairo), `us` (NYSE, Nasdaq and ETFs via
  Alpaca, USD, America/New_York), `uae` (ADX, AED, Asia/Dubai) and `simulator` (Thndr's paper-trading market). Inputs
  take exactly these four lower-case codes, so the published tool schemas list them. Thndr's wire codes stay in
  the Thndr adapters (anti-corruption layer): `uae` → `adsm` for instruments, `abudhabi` for accounts.
- **Capabilities** are domain knowledge per market (`marketSupports(market, feature)`), based on the live checks
  above. A use case asked for a feature a market lacks fails fast with `FEATURE_DISABLED` and a message naming the
  market and what to use instead — it does not call Thndr for an answer that cannot exist. A `get_markets` tool lists
  the user's markets (from Thndr) with what each supports; tool descriptions say which markets they serve.
- **Market data outside Egypt** comes from the endpoints Thndr offers there: quotes from the gateway's bulk price,
  price history as closing prices (`assets-service/charts`) labelled as such — we do not invent open/high/low values —
  and performance figures from those closes.
- **New read-only features** from the mobile app: gainers/losers (`get_market_movers`, Egypt and US), trending
  instruments (`get_trending`, Egypt, US and UAE), tags (themes) with their instruments (`get_tags`,
  `get_tag_instruments`, Egypt and US), dividends per instrument (`get_dividends`, any market) and the default index
  list per market (`get_market_status` lists the market's own indices). They sit behind a separate
  `DiscoveryRepository` port. Listing a tag's instruments uses Thndr's own endpoint (`assets-service/tags/{id}`), which
  lifts ADR 0018's "tags per instrument only" limitation without crawling.
- Write operations stay documented only (ADR 0006, ADR 0019).

## Consequences

- One market parameter works everywhere, and unsupported combinations explain themselves instead of returning Thndr
  errors.
- The capability table must be re-checked when Thndr adds features (the `sync-thndr-mobile-api` skill and a live check);
  a wrong "unsupported" entry hides a feature until then.
- The mobile gateway becomes a third base URL (`krakend-thndr-app`), with the same token and KrakenD error envelope.
