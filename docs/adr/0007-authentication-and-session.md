# 0007. Authentication and session persistence

- Status: Accepted
- Date: 2026-10-06

## Context

ThndrX authentication (see `docs/api/auth.md`) has two stages:

1. **Identity** — Firebase (project `thndr-api`). Methods: email OTP (Thndr's `auth-service` mails a 6-digit code
   and returns a Firebase *custom token*), Google or Apple popups.
2. **Device approval (2FA)** — the client creates a *token request*; the user approves it **inside the already
   logged-in Thndr mobile app** (QR/deep link `thndr://goToRoute?routeName=HUMAN_ID&…`). After approval the client
   exchanges it at `POST https://x.thndr.app/api/auth/login` for a 15-minute full-access JWT and an httpOnly refresh
   cookie (client-side hint: ~6 h), renewed via `POST /api/auth/refresh`.

There is no request signing, device attestation or captcha on these endpoints, so a plain Node client can
perform the same flow. Google/Apple popups cannot run headlessly; email OTP can.

## Decision

1. **Primary login = email OTP + mobile approval**, exposed as MCP tools and a CLI:
   `login_start(email)` → `login_verify_code(code)` (returns the deep link / human id to approve) →
   `login_complete()` (polls until approved, then stores the session).
2. **Re-approval without OTP.** The Firebase session is persisted, so when the Thndr refresh cookie expires the
   user only needs to approve a new request on the phone (`login_request_approval`).
3. **Fallback import.** `login_import_session` accepts the `Cookie` header of an authenticated `x.thndr.app`
   browser session (and optionally an access token), for accounts that sign in with Google/Apple only.
4. **Token lifecycle** mirrors ThndrX: access token treated as *about to expire* 180 s before expiry and refreshed
   proactively; on a 401/403 the HTTP client invalidates the token, refreshes once and retries. Refresh failures of
   type `INVALID_REFRESH_TOKEN | MISSING_REFRESH_TOKEN | EXPIRED_REFRESH_TOKEN` end the session and ask the user to
   approve again. Concurrent refreshes are single-flighted.
5. **Storage.** One JSON file, `$THNDR_SESSION_FILE` or `~/.config/thndr-mcp/session.json`, created with mode
   `0600` in a `0700` directory. It holds the Firebase persistence entries, the refresh cookies and the current access
   token. It is never logged and is git-ignored.
6. The deep link is shown to the user. We never try to auto-approve or bypass the device approval.

## Consequences

- The user must have the Thndr mobile app logged in on their phone to log in (same as ThndrX).
- Sessions survive MCP server restarts until the refresh cookie expires; then one tap on the phone renews them.
- The refresh cookie name is not visible to JS, so we persist *every* cookie set by `/api/auth/login` and
  `/api/auth/refresh` and replay them. This survives a cookie rename by Thndr.
