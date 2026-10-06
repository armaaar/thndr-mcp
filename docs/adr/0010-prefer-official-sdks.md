# 0010. Prefer official SDKs over hand-rolled API calls

- Status: Accepted
- Date: 2026-10-06

## Context

Part of the ThndrX flow talks to Google Firebase Authentication (custom-token sign-in, ID-token refresh). We could
call the Identity Toolkit / Secure Token REST endpoints by hand, or use the official Firebase JS SDK, which
supports Node.js.

## Decision

Where an official SDK covers a need, we use the SDK instead of reverse-engineered or hand-written HTTP calls:

- **Firebase Auth** via the modular `@firebase/app` + `@firebase/auth` packages (not the `firebase` umbrella
  package, which drags Firestore/gRPC). We use `signInWithCustomToken`, `getIdToken` (auto-refresh) and `signOut`.
  Persistence across restarts uses a small file-backed implementation of Firebase's key-value persistence
  contract (the same shape as its built-in `inMemoryPersistence`), stored inside our session file.
- **MCP** via `@modelcontextprotocol/sdk`.

Raw HTTP is used only for Thndr's own endpoints, for which no SDK exists.

## Consequences

- Less code to maintain; Firebase token refresh semantics are handled by Google's code.
- The custom persistence relies on the shape of Firebase's persistence classes (`_get/_set/_remove`). It is
  isolated in `src/data-sources/firebase/` and covered by tests; if it breaks, the fallback is simply that the user
  repeats the email OTP step.
