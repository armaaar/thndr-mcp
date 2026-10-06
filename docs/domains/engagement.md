# Engagement (supporting subdomain)

The user's own lists and signals around the market: **custom watchlists**, **price alerts** and in-app
**notifications**. None of it moves money, so it is allowed by [ADR 0006](../adr/0006-trading-safety.md) as
non-financial list management. It is downstream of [Market Data](market-data.md): users name instruments by ticker,
Thndr stores asset ids, and Market Data translates between the two.

Code: `src/domain/engagement/` (repository interface in `repository.ts`), `src/application/engagement/`,
`src/infrastructure/repositories/thndr/engagement-repository.ts` (+ `data-sources/thndr/dto/engagement.ts`,
`repositories/thndr/translators/engagement.ts`); use-case classes in `src/application/engagement/queries/` and
`commands/`, shared `InstrumentLabeler` in `src/application/engagement/services/`.
API: [docs/api/market-data.md](../api/market-data.md) §4 (watchlists), §5.2 (price alerts) and the misc part §5
(notifications). Use cases: [use-cases/engagement.md](../use-cases/engagement.md).

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Watchlist** | A named, ordered list of instruments the user follows, per market. Thndr calls these "custom watchlists" (`/users-service/watchlists`). The built-in "Favorites" list (`/assets-service/watchlist`) is a different resource and is not modelled. |
| **Watchlist name** (`WatchlistName`) | The label of a watchlist: trimmed, 1–50 characters (emoji count as one). |
| **Colour / icon** | ThndrX palette and icon keys (`color_4`, `thndr`). Cosmetic, read-only for us. |
| **Watch / unwatch** | Adding / removing instruments to / from a watchlist (`watch-assets`, `unwatch-assets`). |
| **Price alert** | A request to be notified when an instrument's price crosses a **target price**. |
| **Target price** | The trigger value of an alert (`price` on the wire). Always > 0. |
| **Direction** | `UP` (fire when the price rises to/above the target) or `DOWN` (falls to/below). |
| **Direction rule** | ThndrX derives the direction from the current price: target **below** current → `DOWN`, otherwise `UP` (equal → `UP`). Implemented by `deriveAlertDirection`. |
| **Frequency** | `ONE_TIME` (consumed when it fires — the default) or `RECURRING` (re-arms). |
| **Notification** | An in-app message (order completed/rejected/…, `price_alert_triggered`, announcements) with a read flag. |
| **Unread flag** | Whether *any* notification is unread (`has-unread`), independent of the page being viewed. |
| **Mark read** | Marking listed notifications (batch) or all of them as read. |
| **Instrument label** | Presentation data for an asset id: ticker, name, last price, change % — built by `InstrumentLabeler`. |

## Aggregates and invariants

| Element | Kind | Invariants / behaviour |
| --- | --- | --- |
| `Watchlist` | aggregate root (`createWatchlist`) | `id` non-empty (trimmed). `instrumentIds` are `AssetId`s, keep Thndr's order and are de-duplicated (first occurrence wins). `name` is the upstream value (may be `''` when the detail payload omits it); `color`/`icon` nullable. Frozen. |
| `WatchlistName` | value object | Trimmed; 1–50 characters; used for every name we *send* (create, rename). |
| `PriceAlert` | aggregate root (`createPriceAlert`) | `id` non-empty; `targetPrice` finite and > 0; `instrumentId` is an `AssetId`. `ticker`, `direction`, `frequency`, `createdAt` are nullable (unknown upstream values become null; invalid dates are dropped). Frozen. |
| `deriveAlertDirection(target, current)` | domain service | Both prices > 0; `target < current → DOWN`, else `UP`. |
| `parseAlertDirection` / `parseAlertFrequency` | parsers | Case-insensitive; aliases `above`/`below`, `once`/`one-time`/`repeat`. Empty → null (caller applies the default); unknown → `VALIDATION_ERROR`. |
| `Notification` | entity (`createNotification`) | `id` non-empty; `title`/`text` default to `''`; `read` is true only when Thndr says `is_read: true`; `type` is Thndr's `type` or `action`; invalid dates → null. Frozen. |

Business rules enforced in the application layer:

- A single watchlist edit cannot both add and remove the same instrument.
- At most 100 symbols per watchlist call; at most 200 notification ids per mark-read call.
- An alert's direction must be explicit when there is no current price to derive it from.
- **Updating an alert replaces it**: Thndr has no update endpoint, so an update deletes the alert and creates a new
  one with a new id (as ThndrX does). If re-creation fails, the original is restored (best effort).
- Deleting an alert that no longer exists succeeds (Thndr answers 404 for fired one-time alerts; ThndrX ignores it).

## Application services

### `InstrumentLabeler`
Turns asset ids into tickers (and quote snippets) for presentation. It reads the whole-market snapshot through
`MarketQuotesCache` (one cached call) and falls back to `InstrumentResolver` for ids missing from it (indices,
funds). It **never fails**: snapshot errors and unknown/delisted ids produce a label with `null` fields, so a stale
id in a watchlist never breaks listing it. `currentPrice(id, market)` gives the last price used by the direction rule.

## Repository

`EngagementRepository` (domain repository, `src/domain/engagement/repository.ts`), implemented by
`ThndrEngagementRepository` (`src/infrastructure/repositories/thndr/engagement-repository.ts`) and received by the
use cases as the `repository` dependency: `listWatchlists`, `getWatchlist`, `createWatchlist`,
`renameWatchlist`, `deleteWatchlist`, `addToWatchlist`, `removeFromWatchlist`, `listPriceAlerts`,
`listAlertsForInstrument`, `createPriceAlert` (returns `null` when Thndr's reply does not describe the alert),
`deletePriceAlert` (idempotent), `listNotifications`, `hasUnreadNotifications`, `markNotificationsRead`,
`markAllNotificationsRead`. The in-memory test double is `src/__tests__/support/fake-engagement.ts`.

## Anti-corruption notes

- Watchlists live on `prod` (`https://prod.thndr.app`); alerts and notifications on KrakenD
  (`https://prod.thndr.app/krakend-thndr-x`) — every KrakenD response is checked with `assertNoKrakendError`
  (`error_price_alerts`, `error_get_notifications`, `error_get_notifications_has_unread`,
  `error_patch_notifications_batch`, `error_patch_notifications_read_all`).
- Watchlist detail returns only `{ asset_ids }`: the repository keeps the requested id and the use case borrows the
  name/colour/icon from the list.
- Create-watchlist and create-alert responses are only partly known: the repository completes them with the request
  values. A created watchlist without an id is an `UPSTREAM_ERROR`; a created alert without one is looked up in the
  per-asset alert list.
- The notifications list is a bare array per ThndrX; a KrakenD `{ collection: [...] }` wrapper is accepted too.
- Malformed rows (no id, invalid asset id, non-positive price) are skipped; unknown enum values become `null`.
