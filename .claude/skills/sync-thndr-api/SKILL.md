---
name: sync-thndr-api
description: Re-sync thndr-mcp with the latest ThndrX (x.thndr.app) deployment — download the public bundle, diff the reverse-engineered API surface, bump the x-thndrx-runtime-version, and update docs/api, DTOs, translators and tests together. Use whenever Thndr endpoints start failing (unexpected 4xx/5xx, missing fields, MAPPING errors), when the user says Thndr/ThndrX "changed", "updated", "broke", asks to "sync", "refresh" or "re-check" the Thndr API, or before a release of thndr-mcp.
---

# Sync the Thndr API

thndr-mcp talks to Thndr's **private** API, reverse-engineered from ThndrX's public JavaScript bundle (ADR 0004).
Thndr redeploys without notice, so this workflow re-derives what changed and updates the anti-corruption layer
(Thndr data source `src/infrastructure/data-sources/thndr/**` and repositories + translators
`src/infrastructure/repositories/thndr/**`) in one coherent change. Scope stays **read-only** (ADR 0006): if new order-entry or
fund-movement endpoints appear, note them in the diff summary but do not document or implement them.

## 1. Pull the latest bundle and diff the surface

```bash
npm run sync:api                       # → .cache/thndr-bundle/{js/,surface.json}, docs/api/endpoints.generated.md
git diff --stat docs/api/endpoints.generated.md
git diff docs/api/endpoints.generated.md
```

The report lists the deployment id, `x-thndrx-runtime-version`, Firebase config, base URLs and every API path.
Classify the diff: version bump only · new paths · removed/renamed paths · base URL or Firebase config change.

If only the deployment id changed, regenerate, commit `chore(api): refresh ThndrX surface report` and stop.

## 2. Runtime version

If `x-thndrx-runtime-version` changed, update `THNDRX_RUNTIME_VERSION` in `src/config.ts` (tests read it from there).
Servers may reject stale versions, so this is the most common fix.

## 3. Re-derive changed endpoints that we use

Find which paths our repositories and auth gateway call (string literals, template literals and path constants):

```bash
grep -rhoE "['\`]/[a-zA-Z0-9/_{}\$.:-]+['\`]" src/infrastructure/repositories/thndr/ src/infrastructure/data-sources/thndr/ | sort -u
```

For each used path that changed, locate and read its call sites in the de-minified bundle:

```bash
.claude/skills/sync-thndr-api/scripts/find-call-sites.sh "/market-service/v3/orders"
```

From the call site, re-derive: HTTP method, axios client (`aP` = prod.thndr.app, `Kc` = krakend, `Z$` = x.thndr.app/api
— see docs/api/auth.md §0), query params, body, and which response fields the UI reads (field names are reliable;
types are inferred — mark them [I] in the docs).

## 4. Update everything together

Change these in the same commit so they never drift:

1. `docs/api/*.md` — the human spec (keep [C]/[I] markers and evidence snippets with the new chunk names).
2. `src/infrastructure/data-sources/thndr/dto/*.ts` — wire types (snake_case).
3. `src/infrastructure/repositories/thndr/translators/*.ts` — translation to the domain (anti-corruption layer);
   unknown fields → `null`, never crash.
4. `src/infrastructure/repositories/thndr/*-repository.ts` and `auth-gateway.ts` — paths/params.
5. Tests and fixtures under `tests/infrastructure/repositories/thndr/**` (and
   `tests/infrastructure/data-sources/thndr/**` for HTTP-client or KrakenD changes).

Domain and application code should rarely change; if it must, the API change altered business meaning — call that
out and consider an ADR.

## 5. Verify against real data (optional, needs a session)

```bash
npm run login            # if not logged in (= `thndr login`; the session is shared with the MCP server)
npm run capture:fixtures # GET-only; writes .cache/fixtures/*.json and SHAPES.md (git-ignored, PII-redacted)
```

Compare `SHAPES.md` with the DTOs; promote confirmed fields from [I] to [C] in the docs. Never commit `.cache/`.

## 6. Gate, review, commit

```bash
npm run check            # typecheck + lint + coverage (> 95%)
```

Ask the `qa-reviewer` agent to review the change — the author never approves their own work. Then commit:

```
fix(infra): sync with ThndrX <runtime-version>

- <endpoint>: <what changed>
```
