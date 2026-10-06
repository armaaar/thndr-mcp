---
name: reverse-engineer-thndr-mobile
description: Reverse-engineer the Thndr Android app (com.axismarkets.thndr) to learn the private API it uses — download the APK, unpack it, decompile its Hermes JavaScript bundle and document endpoints per market (Egypt/EGX, US, UAE/ADX) in docs/api. Use this whenever thndr-mcp needs something the ThndrX web bundle does not show — US or UAE market support, endpoints only the mobile app calls (dividends, IPOs, US quotes, global markets…), a feature the user "sees in the app", or when the user asks to decompile, inspect or re-check the mobile app, even if they don't say "reverse engineer". For the web bundle (x.thndr.app) use sync-thndr-api instead.
---

# Reverse-engineer the Thndr mobile app

thndr-mcp's API knowledge comes from the ThndrX web bundle (`sync-thndr-api`, ADR 0004). The web app only really serves
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
.claude/skills/reverse-engineer-thndr-mobile/scripts/fetch-apk.sh        # → .cache/thndr-mobile/<version>/, latest → it
```

It installs EFF's `apkeep` project-locally, downloads the arm64 split XAPK, unpacks it and prints the app version,
the bundle path and its format. Expect `Hermes JavaScript bytecode, version N` (12.56.0 used v96). If the format is no
longer Hermes (plain JS, or no `index.android.bundle`), the decompile step changes accordingly: plain JS just needs a
beautifier.

## 2. Decompile the Hermes bundle

Hermes stores the app as bytecode with a string table. Naive `strings` output is useless: the table packs strings
back to back. Use a decompiler that supports the bundle's bytecode version, installed in a project-local virtualenv:

```bash
.claude/skills/reverse-engineer-thndr-mobile/scripts/decompile.sh        # → .cache/thndr-mobile/latest/decompiled/
```

The script prefers `hermes-dec` (P1sec), which disassembles and decompiles to pseudo-JS. If a newer bytecode version
is not supported yet, check the decompiler's releases, then fall back to its disassembler (string table + calls are
usually enough to read request shapes).

## 3. Find the API surface

```bash
python3 -I .claude/skills/reverse-engineer-thndr-mobile/scripts/find-endpoints.py .cache/thndr-mobile/latest/decompiled
python3 -I .claude/skills/reverse-engineer-thndr-mobile/scripts/find-endpoints.py .cache/thndr-mobile/latest/decompiled --grep "market-service/v3/orders"
```

The first form lists every API path literal with how often it appears; `--grep` prints each hit with surrounding
lines so you can read the call (client/base URL, method, params, body, fields read from the response).

What to look for, per market (`egypt`, `us`, `adsm` = UAE asset data, `abudhabi` = ADX account/status, `simulator`):
- how the app decides which markets the user has (accounts, eligibility, feature flags);
- market data: search, details, bulk quotes, price history, market status (`market_exchange` per market), order book,
  trades, news, financials, dividends, movers, indices;
- account data: wallet/portfolio, positions, orders, activity (provider per market), returns, journal, watchlists,
  alerts, notifications, savings — and which market value each sends;
- currencies and sessions per market.

## 4. Verify live (read-only) and update everything together

Confirm each finding with one GET against the live API in a single process, spaced out (Thndr rate-limits bursts —
HTTP 429 — including token refreshes). Then follow `sync-thndr-api` §4: update `docs/api/*.md` (keep `[C]/[I]/[P]`
markers and cite the decompiled function or string), DTOs, translators, repositories and tests in one change, run
`npm run check`, and have the `qa-reviewer` agent review it. Record the app version you analysed in the docs.
