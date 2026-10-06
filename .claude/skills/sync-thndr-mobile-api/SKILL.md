---
name: sync-thndr-mobile-api
description: Reverse-engineer the Thndr Android app (com.axismarkets.thndr) to learn the private API it uses — download the APK, unpack it, decompile its Hermes JavaScript bundle and document endpoints per market (Egypt/EGX, US, UAE/ADX) in docs/api. Use this whenever thndr-mcp needs something the ThndrX web bundle does not show — US or UAE market support, endpoints only the mobile app calls (dividends, IPOs, US quotes, global markets…), a feature the user "sees in the app", or when the user asks to decompile, inspect or re-check the mobile app, even if they don't say "reverse engineer". For the web bundle (x.thndr.app) use sync-thndr-web-api instead.
---

# Reverse-engineer the Thndr mobile app

thndr-mcp's API knowledge comes from the ThndrX web bundle (`sync-thndr-web-api`, ADR 0004). The web app only really serves
Egypt; the mobile app serves every market (Egypt, US via Alpaca, UAE/ADX). This workflow reads the mobile app's code to
learn what the web bundle cannot tell us. It is the same kind of interoperability work as the web bundle — reading a
client to build a compatible read-only client — so the same rules apply.

## Ground rules (and why)

- **Static analysis only.** The APK comes from a third-party mirror (APKPure) that has shipped modified apps before.
  Unzipping and reading it as data is safe; installing or executing it is not. Never `adb install`, never run native
  libraries or the bundle, and keep your own scripts outside the download folder (pass paths as arguments; run Python
  with `-I`) so nothing in the download can be imported by accident.
- **Document writes, implement reads (ADR 0006, ADR 0019).** Document every write operation you find — orders of all
  types, calculators, subscriptions, funding, savings transfers, settings — with full request shapes and the app's
  safety steps (confirmation, PIN/OTP, idempotency keys), under a "Write operations (documented, not implemented —
  ADR 0006)" heading. Do not implement them: the maintainer adds writes later, each with its own ADR.
- **Everything downloaded or generated stays in `.cache/`** (git-ignored). Commit only what we write: `docs/api/*.md`,
  DTOs, translators, code and tests — never the APK, the bundle or decompiled code.
- **The code tells you shapes; live data tells you truth.** Mark findings `[C]` (seen in code) or `[I]` (inferred), and
  promote to `[P]`/live-verified only after a read-only check against the API.
- **No secrets.** Never read `.thndr/` or `~/.config/thndr-mcp/`; never paste tokens into notes.

## 1. Download and unpack

```bash
.claude/skills/sync-thndr-mobile-api/scripts/fetch-apk.sh        # → .cache/thndr-mobile/<version>/, latest → it
```

It installs EFF's `apkeep` project-locally, downloads the arm64 split XAPK, unpacks it and prints the app version,
the bundle path and its format. Expect `Hermes JavaScript bytecode, version N` (12.56.0 used v96). If the format is no
longer Hermes (plain JS, or no `index.android.bundle`), the decompile step changes accordingly: plain JS just needs a
beautifier.

## 2. Decompile the Hermes bundle

Hermes stores the app as bytecode with a string table. Naive `strings` output is useless: the table packs strings
back to back. Use the pinned decompiler (hermes-dec handled bytecode v96 in ~20 s), installed in a project-local
virtualenv:

```bash
.claude/skills/sync-thndr-mobile-api/scripts/decompile.sh               # → .cache/thndr-mobile/latest/decompiled/
.cache/thndr-mobile/venv/bin/python -I .claude/skills/sync-thndr-mobile-api/scripts/dump-strings.py \
  .cache/thndr-mobile/latest/base/assets/index.android.bundle .cache/thndr-mobile/latest/decompiled/strings.tsv
```

`decompiled.js` (~110 MB) is register-level pseudo-JS: readable enough to follow a call, too big to read whole — search
it. `strings.tsv` lists every string literal with its index (use `grep -a`: some strings hold binary bytes). If a newer
bytecode version is not supported, check hermes-dec's releases and bump the pinned commit in `decompile.sh`.

## 3. Find the API surface

```bash
python3 -I .claude/skills/sync-thndr-mobile-api/scripts/find-endpoints.py .cache/thndr-mobile/latest/decompiled
python3 -I .claude/skills/sync-thndr-mobile-api/scripts/find-endpoints.py .cache/thndr-mobile/latest/decompiled --grep "visible-markets"
python3 -I .claude/skills/sync-thndr-mobile-api/scripts/find-endpoints.py .cache/thndr-mobile/latest/decompiled --markets
```

The first form lists every API path literal with how often it appears (293 in app 12.56.0); `--grep` prints each hit
with surrounding lines so you can read the call; `--markets` shows lines mentioning market codes.

What the app looked like in 12.56.0 (start here, then confirm for the version you analyse; the full write-up is in
[docs/api/mobile-app.md](../../../docs/api/mobile-app.md)):
- **Clients.** `thndrApi` → `https://prod.thndr.app/` (paths without a leading slash, e.g. `assets-service/...`);
  `apiGateway` → `https://prod.thndr.app/krakend-thndr-app` (the app's own gateway — not ThndrX's
  `krakend-thndr-x`: `securities/v2/price`, `explore/v1/...`, `wallet/v1/...`, `portfolio/v1|v2/...`, `lists/v1/...`).
  Gateway errors come back as `error_<section>` keys in a 200 body, like ThndrX's KrakenD.
- **Markets.** The server says which markets a user has (`compliance-service/eligibilities/v2/visible-markets`).
  Account calls use `egypt`, `us`, `abudhabi`, `simulator`; UAE instrument data uses `adsm`. Activity providers are
  `EGID`, `ALPACA`, `ADX_UAE`. Market status takes `market_exchange` = the asset's board for Egypt, `NOPL` for US,
  `adsm` for UAE.
- **Headers.** The app sends `X-DUID`, `sessionId`, `X-Language`, `x-correlation-id` and no
  `x-thndrx-runtime-version`; whether the gateway needs the device headers is something only a live call shows.

What to look for, per market (`egypt`, `us`, `adsm` = UAE asset data, `abudhabi` = ADX account/status, `simulator`):
- how the app decides which markets the user has (accounts, eligibility, feature flags);
- market data: search, details, bulk quotes, price history, market status, order book, trades, news, financials,
  dividends, movers, indices;
- account data: wallet/portfolio, positions, orders, activity, returns, watchlists, alerts, notifications, savings —
  and which market value each sends;
- write operations (orders, calculators, subscriptions, funding, savings transfers) and their safety steps;
- currencies and sessions per market.

## 4. Verify live (read-only) and update everything together

Confirm each finding with one GET against the live API in a single process, spaced out (Thndr rate-limits bursts —
HTTP 429 — including token refreshes). Then follow `sync-thndr-web-api` §4: update `docs/api/*.md` (keep `[C]/[I]/[P]`
markers and cite the decompiled function or string), DTOs, translators, repositories and tests in one change, run
`npm run check`, and have the `qa-reviewer` agent review it. Record the app version you analysed in the docs.
