# 0004. Reverse-engineer the ThndrX web client

- Status: Accepted
- Date: 2026-10-06

## Context

Thndr publishes no API. Options considered:

1. **Decompile the Android/iOS app** (APK/IPA) — heavy tooling, obfuscation, possible certificate pinning, and
   mobile-device attestation is likely required at runtime.
2. **Intercept mobile traffic with mitmproxy** — requires a rooted device or patched app; not reproducible by
   other community users.
3. **Analyse ThndrX (`https://x.thndr.app`)**, Thndr's official browser trading platform (Next.js). Its JavaScript
   bundles are publicly downloadable and contain the complete API client: base URLs, paths, auth interceptors,
   payload builders.

## Decision

We will treat the ThndrX web client as the source of truth for the API surface and authentication flow, and act
as a *browser-equivalent* client: same endpoints, same headers (`authorization`, `x-thndrx-runtime-version`,
`X-Language`), same token lifecycle. Findings are documented in `docs/api/`, citing the bundle evidence.

## Consequences

- Reproducible by anyone: the analysis only needs public static assets.
- ThndrX requires an active *Thndr Trader* subscription; users without it may be unable to obtain a full-access
  session. This is documented in the README.
- Thndr can redeploy at any time; the `x-thndrx-runtime-version` header and endpoint shapes may drift. Mitigation:
  all wire knowledge lives in the anti-corruption layer and mapping failures surface as explicit errors.
- This is an unofficial project; users act on their own account and accept Thndr's terms.
