# Identity & Access use cases

Code: one class per use case in `src/application/identity/queries/` and `commands/`; application services
`SessionTokenProvider` and `DeviceApprovalRequester` in `src/application/identity/services/`. Every login step except
`auth_status` is a CQS command and returns a flat receipt (ids, flags, a message), never a read model; `auth_status`
is the query that reports the resulting state
([ADR 0015](../adr/0015-five-layer-clean-architecture-cqs-and-context-map.md)). MCP tools and CLI commands are generated from these classes; CLI positionals
come from `src/presentation/cli/positionals.ts`, the guided login (`thndr login` and the MCP login on demand) from `src/presentation/presenters/guided-login.ts`. Domain: [domains/identity-and-access.md](../domains/identity-and-access.md).
API: [api/auth.md](../api/auth.md).

**Actor** for every use case: the LLM agent (MCP) or the account holder at a terminal (CLI `thndr`), acting on
behalf of the Thndr account holder. The account holder must take part (read the emailed code, approve on the phone).

## One session for MCP and CLI

The pending login (`LoginFlow`) and the session are persisted in the same owner-only session file through
`LoginFlowRepository` and `SessionRepository`
([ADR 0013](../adr/0013-persisted-login-flow-and-shared-session.md)). Consequences:

- Each login step can run in a separate process: `thndr login-start`, `thndr login-verify-code` and
  `thndr login-complete` are three CLI invocations, and an MCP login survives a server restart between steps.
- Logging in (or out) through the MCP server or the CLI affects both: they read the same file, uncached.
- The **guided login** is a presentation-layer composite of the same use cases (`auth_status` → `login_start` →
  `login_verify_code`, or `login_request_approval` when already identified → `login_complete`, retried up to 5 times
  with a 60 s timeout). It runs every step through `runAndPresent` and adds no logic
  ([ADR 0012](../adr/0012-use-case-classes-shared-by-mcp-and-cli.md)); it talks to the user through a `LoginDialog`:
  - `thndr login` prompts on the terminal (`presentation/cli/login-command.ts`).
  - The MCP server runs it **on demand** ([ADR 0016](../adr/0016-login-on-demand-via-mcp-elicitation.md),
    `presentation/mcp/login-on-demand.ts`): when a non-identity tool fails with `NOT_AUTHENTICATED` or
    `SESSION_EXPIRED` and the client supports form elicitation, the server asks for the email, the code and the phone
    approval through elicitation, then retries the tool once. Declined or failed logins return the original error plus
    a `login` field. Cancelling the tool call cancels the dialog; approval progress is sent as MCP progress
    notifications when the call has a progress token. Without elicitation the error is returned unchanged.
  - Thndr sends no push notification for the approval: both dialogs show the approval deep link as a QR code
    (`presentation/presenters/qr.ts`) to scan with the phone, as ThndrX does, plus the link itself.
  - Sentences addressed to an agent ("Call login_complete again.") are dropped from what the person sees (`forPerson`).

```sh
thndr login                          # guided: prompts for email, code, then waits for phone approval
# or step by step (each line is a separate process):
thndr login-start you@example.com
thndr login-verify-code 123456
thndr login-complete --timeout-seconds 120
```

Hosts: `prod` = `https://prod.thndr.app`, `web` = `https://x.thndr.app/api`.

## Full login sequence

```mermaid
sequenceDiagram
    actor U as Account holder
    participant A as LLM agent
    participant S as thndr-mcp
    participant T as Thndr (prod / web)
    participant F as Firebase Auth
    participant P as Thndr mobile app

    A->>U: Ask for Thndr email
    A->>S: login_start(email)
    S->>T: POST prod /auth-service/v2/users/email-code {email}
    T-->>S: {id: verificationId}
    T-->>U: Email with 6-digit code
    S-->>A: {maskedEmail, message}  (flow: CODE_SENT)

    U->>A: Code
    A->>S: login_verify_code(code)
    S->>T: POST prod /auth-service/v2/users/login {id, code}
    T-->>S: {firebase_auth_token}
    S->>F: signInWithCustomToken, getIdToken
    F-->>S: Firebase ID token (persisted)
    S->>T: POST prod /auth-service/tokens/request {data:{scopes}, credentials:{firebase_token}}
    T-->>S: {id, request_secret, human_id}
    S-->>A: {humanId, deepLink, requestId, message}  (flow: AWAITING_APPROVAL)
    A->>U: "Approve the login in the Thndr app (code humanId)"

    A->>S: login_complete(timeoutSeconds=60)
    U->>P: Approve request
    loop every 1 s until approved or timeout
        S->>T: POST prod /auth-service/tokens/request/{id}/status
        T-->>S: {status: pending | approved}
    end
    S->>T: POST web /auth/login {request_id, request_secret, firebase_token, platform:"thndrx_web"}
    T-->>S: {auth_token, auth_token_expires_at, refresh_token_expires_at} + Set-Cookie
    S->>S: Save ThndrSession to session file (flow: IDLE)
    S-->>A: {status: approved, authenticated: true, accessTokenExpiresAt, sessionExpiresAt}
```

---

## Check session status — `auth_status` (`GetAuthStatus`)

- **Use case:** `GetAuthStatus` (`Query`) in `src/application/identity/queries/get-auth-status.ts`
- **Invoke:** MCP `auth_status` · CLI `thndr auth-status`
- **Goal:** know whether the server is logged in and which login step is pending.
- **Preconditions:** none.
- **Input:** none.
- **Main flow:**
  1. Load the stored session and (in parallel) the Firebase ID token; a Firebase failure counts as "not identified".
  2. Read the current login-flow stage.
  3. Report.
- **Alternative/error flows:** none expected (this is the tool to call after `NOT_AUTHENTICATED` / `SESSION_EXPIRED`).
- **Output:** `authenticated` (session exists and refresh credential not expired), `identified` (Firebase ID token
  available), `pendingStep` (`none` | `verify_code` | `approve_on_phone`), `accessTokenExpiresAt`,
  `sessionExpiresAt`, `sessionEstablishedAt` (ISO strings or null).
- **Thndr endpoints:** none.

## Start login — `login_start` (`StartLogin`)

- **Use case:** `StartLogin` (`Command`) in `src/application/identity/commands/start-login.ts`
- **Invoke:** MCP `login_start {"email": "you@example.com"}` · CLI `thndr login-start you@example.com` (or
  `--email`)
- **Goal:** have Thndr email a one-time code (step 1 of 3).
- **Preconditions:** the user has a Thndr account with that email.
- **Input:** `email`.
- **Main flow:**
  1. Validate and normalise the email.
  2. Request the code; receive a verification id.
  3. Move the login flow to `CODE_SENT` (overwrites any previous flow) and persist it.
- **Alternative/error flows:**
  - Invalid email → `VALIDATION_ERROR`.
  - Thndr error or missing verification id → `UPSTREAM_ERROR`.
- **Output:** `maskedEmail` (`a***@example.com`), `message` (next step: `login_verify_code`).
- **Thndr endpoints:** `POST prod /auth-service/v2/users/email-code`.

## Verify the code — `login_verify_code` (`VerifyLoginCode`)

- **Use case:** `VerifyLoginCode` (`Command`) in `src/application/identity/commands/verify-login-code.ts`
- **Invoke:** MCP `login_verify_code {"code": "123456"}` · CLI `thndr login-verify-code 123456` (or `--code`)
- **Goal:** prove the email, establish the Firebase identity and create the phone approval (step 2 of 3).
- **Preconditions:** persisted flow is `CODE_SENT` (from a `login_start` in this or any earlier process).
- **Input:** `code` (whitespace is stripped; 4–8 digits).
- **Main flow:**
  1. Validate the code format.
  2. Verify it with Thndr; receive a Firebase custom token.
  3. Sign in to Firebase with it (identity is persisted).
  4. Create the device approval through the `DeviceApprovalRequester` application service — the same steps as
     [Request phone approval](#request-phone-approval--login_request_approval-requestdeviceapproval) (use cases never
     call each other).
- **Alternative/error flows:**
  - Empty or malformed code → `VALIDATION_ERROR`.
  - No code requested → `LOGIN_NOT_STARTED`.
  - Wrong/expired code or missing token → `UPSTREAM_ERROR`.
- **Output:** `humanId`, `requestId`, `deepLink` (`thndr://goToRoute?routeName=HUMAN_ID&…`), `message` to relay
  to the user.
- **Thndr endpoints:** `POST prod /auth-service/v2/users/login`, Firebase `signInWithCustomToken`,
  `POST prod /auth-service/tokens/request`.

## Request phone approval — `login_request_approval` (`RequestDeviceApproval`)

- **Use case:** `RequestDeviceApproval` (`Command`) in `src/application/identity/commands/request-device-approval.ts`
- **Invoke:** MCP `login_request_approval` · CLI `thndr login-request-approval`
- **Goal:** create a new device approval without an email code (re-approval after `SESSION_EXPIRED`).
- **Preconditions:** a Firebase identity exists (from an earlier `login_verify_code`).
- **Input:** none.
- **Main flow** (in the `DeviceApprovalRequester` application service, shared with `login_verify_code`):
  1. Get the Firebase ID token.
  2. Create a token request with ThndrX's scope list.
  3. Move the flow to `AWAITING_APPROVAL` and persist it (including the request secret).
- **Alternative/error flows:**
  - No Firebase identity → `NOT_AUTHENTICATED` ("call login_start").
  - Thndr error or missing `id`/`request_secret` → `UPSTREAM_ERROR`.
- **Output:** same as `login_verify_code`.
- **Thndr endpoints:** `POST prod /auth-service/tokens/request`.

## Complete login — `login_complete` (`CompleteLogin`)

- **Use case:** `CompleteLogin` (`Command`) in `src/application/identity/commands/complete-login.ts`
- **Invoke:** MCP `login_complete {"timeoutSeconds": 60}` · CLI `thndr login-complete [--timeout-seconds 60]`
- **Goal:** wait for the phone approval and store the session (step 3 of 3).
- **Preconditions:** persisted flow is `AWAITING_APPROVAL`; user has the Thndr app logged in on their phone.
- **Input:** `timeoutSeconds` (0–300, default 60).
- **Main flow:**
  1. Get the Firebase ID token.
  2. Poll the request status every second until it is no longer `pending`/`unknown`.
  3. On `approved`, exchange the request for a full-access token and refresh cookie(s).
  4. Build a `ThndrSession`, save it, reset the flow to `IDLE`.
- **Alternative/error flows:**
  - No pending approval → `NO_PENDING_APPROVAL`.
  - Firebase identity lost → `NOT_AUTHENTICATED`.
  - Timeout while still pending → success response with `authenticated: false`, `status: pending`; flow kept, call
    again after the user approves.
  - `rejected` or `expired` → `authenticated: false` with that status; flow reset; use `login_request_approval`.
  - `claimed` (already used) → `UPSTREAM_ERROR`; flow reset.
  - Exchange sets no cookie, or other Thndr error → `UPSTREAM_ERROR`.
- **Output:** `status`, `authenticated`, `message`, and on success `accessTokenExpiresAt`, `sessionExpiresAt`.
- **Thndr endpoints:** `POST prod /auth-service/tokens/request/{id}/status`, `POST web /auth/login`.

## Import a browser session — `login_import_session` (`ImportSession`)

- **Use case:** `ImportSession` (`Command`) in `src/application/identity/commands/import-session.ts`
- **Invoke:** MCP `login_import_session {"cookieHeader": "…"}` · CLI `thndr login-import-session '<cookie header>'`
  (or `--cookie-header`)
- **Goal:** log in when the account uses Google/Apple sign-in (no email OTP possible headlessly).
- **Preconditions:** the user is logged in at `https://x.thndr.app` in a browser.
- **Input:** `cookieHeader` — the `Cookie` request header of any `x.thndr.app/api` request.
- **Main flow:**
  1. Parse the header into a refresh credential.
  2. Refresh once with it to obtain a full-access token (and any rotated cookies).
  3. Merge cookies, save the session.
- **Alternative/error flows:**
  - Header shorter than 3 characters → `INVALID_INPUT`; no `name=value` pairs → `VALIDATION_ERROR`.
  - Cookies rejected (`INVALID/MISSING/EXPIRED_REFRESH_TOKEN` or 401) → `SESSION_EXPIRED`.
  - Other Thndr error → `UPSTREAM_ERROR`.
- **Output:** `authenticated: true`, `accessTokenExpiresAt`.
- **Thndr endpoints:** `POST web /auth/refresh`.

## Log out — `logout` (`Logout`)

- **Use case:** `Logout` (`Command`) in `src/application/identity/commands/logout.ts`
- **Invoke:** MCP `logout` · CLI `thndr logout [--forget-identity]`
- **Goal:** end the session and delete stored tokens.
- **Preconditions:** none (idempotent).
- **Input:** `forgetIdentity` (default `false`; `true` also signs out of Firebase, so the next login needs an
  email code).
- **Main flow:**
  1. If a session exists, call Thndr logout (best effort; failures ignored) and clear the session file.
  2. Optionally sign out of Firebase.
  3. Reset the persisted login flow.
- **Alternative/error flows:** none surfaced for the remote call.
- **Output:** `loggedOut: true`.
- **Thndr endpoints:** `DELETE web /auth/logout`.

## Supply an access token (internal) — `SessionTokenProvider`

Not a use case (neither an MCP tool nor a CLI command) but an application service: used by every authenticated Thndr call (`AccessTokenProvider` port).

1. No session → `NOT_AUTHENTICATED`.
2. Cached token `VALID` → use it.
3. `ABOUT_TO_EXPIRE` (≤ 180 s left) → use it and refresh in the background.
4. Otherwise refresh (single-flighted) via `POST web /auth/refresh`, merge rotated cookies, save, use the new token.
5. Refresh credential expired or rejected → clear the session, `SESSION_EXPIRED`; the agent should call
   `login_request_approval` then `login_complete`.
6. On 401/403 the HTTP client invalidates the token and retries once; a second 401 → `NOT_AUTHENTICATED`.
