# 0018. Close the IBKR gaps with Thndr data only

- Status: Accepted
- Date: 2026-10-06
- Extends: [0008](0008-ibkr-mcp-as-reference.md) (the IBKR tool surface as reference)

## Context

Comparing thndr-mcp with the IBKR MCP left gaps: portfolio allocation and performance (IBKR "PortfolioAnalyst"),
thematic research, quote statistics, savings balances, and trade periods. A probe of the ThndrX bundle and of the live
API (read-only GETs with a free account, 2026-10-06) showed what Thndr actually provides:

- Index members: an index's asset details carry `constituents` (EGX30, EGX30 Capped, EGX70 EWI, EGX100 EWI, EGX35-LV,
  Shariah, Tamayuz). Instrument details carry `tags` (sector, index, "sharia", "Same Day Tradable", "dollar_hedge"…),
  but there is **no** endpoint that lists the instruments under a tag (in the ThndrX web bundle; the mobile app has
  one, see the update below).
- A "similar stocks" endpoint (`/assets-service/assets/{id}/recommendations`).
- The returns chart (`1M`/`6M` daily points, `1Y`/`2Y` weekly) with `portfolio_value`, `net_deposits` and
  `total_returns` per point. Other intervals return 422.
- Company financials and Egypt's macro data on `x.thndr.app/api` (`/financials`, `/macros`), called with the same
  full-access bearer token; news on `prod.thndr.app/api/post/news/` (per instrument, and market-wide).
- Savings ("Clouds") balances and yields, saved screeners, and ThndrX's built-in screener presets.
- Not provided: alert pause, order drafts or order deep links, derivatives, a company/theme knowledge graph, dividend
  history or calendars. The plan/free-order endpoints and the analyst content (therumble.app) need paid subscriptions.

## Decision

We will add only features whose data comes from Thndr, computed with transparent arithmetic where Thndr does not
compute them itself, and with no workarounds that fake missing data:

| Tool | Context | Source |
| --- | --- | --- |
| `get_portfolio_allocation` | Portfolio | positions × marketwatch sector × index `constituents` |
| `get_portfolio_performance` | Portfolio | returns chart (value, net deposits): value change, gain net of deposits, time-weighted return per period |
| `get_savings` | Portfolio | `/savings/v1/clouds`, `/savings/v1/clouds-stats` (read-only) |
| `period` on journal and activity tools | Portfolio | existing endpoints; dates computed locally, activity paged until the period starts |
| `get_index_constituents`, `index` filter on `screen_market` | Market Data | index `constituents` |
| `get_peers` | Market Data | Thndr's similar stocks + same-sector instruments from marketwatch |
| `tags` on `get_instrument_details` | Market Data | asset details `tags` |
| `get_price_performance` | Market Data | daily candles (returns per period, historical volatility) + Thndr's yearly return |
| `get_financials` | Market Data | `x.thndr.app/api/financials` (+ sector median/min/max as ThndrX computes it) |
| `get_news` | Market Data | `/api/post/news/` |
| `get_economic_indicators` | Market Data | `x.thndr.app/api/macros` |
| `get_screeners`, `screenerId`/`preset` on `screen_market` | Market Data | saved screeners + ThndrX's built-in presets, evaluated on marketwatch as ThndrX does |

Rules:

- Everything stays read-only with respect to money (ADR 0006). Reading savings balances is allowed; transfers are not.
- No paid features: nothing that needs a Thndr subscription or the therumble.app advisory entitlement.
- No crawling to fake an endpoint (for example, fetching every instrument's details to list a tag). Tags are shown per
  instrument only. *(Superseded for tags by ADR 0021: the mobile app's `assets-service/tags/{id}` lists a tag's
  instruments, so `get_tag_instruments` reads a real endpoint and the rule against crawling still holds.)*
- Derived figures say what they are derived from (series granularity, formula), so a model does not mistake them for
  broker figures.
- Membership of indices is cached for 6 hours (it changes at rebalances; an empty list is not cached); the market
  snapshot keeps its 10-second cache.
- Index rows (board `INDX`) are part of the market snapshot: they serve index levels, membership and labels, but are
  excluded from stock screens and rankings, and their placeholder stock fields (bid/ask, P/E, shares, price limits,
  trade date) are reported as unknown.

## Consequences

- thndr-mcp covers IBKR's PortfolioAnalyst tools and part of its research tools with Thndr's own data.
- `x.thndr.app/api` becomes a second base URL for data (it was used for authentication only); its routes are ThndrX's
  own web routes and may change with a ThndrX deployment, like the rest of the private API (ADR 0004).
- Some answers are approximations of Thndr's granularity (weekly points for 1Y/2Y), and say so.
- IBKR tools that stay out of reach: alert pause, order instructions, options/futures/combos, the theme knowledge
  graph, multi-currency balances, `whats_new` and feedback.

## Update (2026-10-06, [ADR 0021](0021-all-thndr-markets.md))

The Thndr Android app's endpoints, checked live read-only, fill two gaps listed above as "not provided" by the web
bundle: **tag → instruments** (`GET /assets-service/tags`, `GET /assets-service/tags/{id}`: `get_tags`,
`get_tag_instruments`) and **dividend history** (`GET /assets-service/assets/{id}/dividends`: `get_dividends`). Both
are Thndr data read from real endpoints, so they follow this ADR's rules; nothing here is crawled or derived.
