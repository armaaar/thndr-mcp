# ThndrX (x.thndr.app) — Authentication Flow Reverse-Engineering Spec

Target: `https://x.thndr.app` web trading platform (Thndr, EGX broker).
Source: de-minified ThndrX Next.js bundles (fetch them with `npm run sync:api`; module ids refer to deployment `dpl_56Z6BSAwsido5k8jnqCao8QoenYw`).
Runtime version observed: **3.8.3** (sent as header `x-thndrx-runtime-version: 3.8.3`).

> TL;DR — Login is a **two-stage** flow:
> 1. **Firebase identity** (email OTP → custom token, OR Google OAuth, OR Apple OAuth) → produces a Firebase ID token.
> 2. **Device approval 2FA**: create a token-request, user approves it inside the already-signed-in **Thndr mobile app** (QR / deep link), poll for `approved`, then exchange (firebase token + request secret) at a Next.js API route for the **FULL_ACCESS** JWT + an httpOnly **refresh cookie**.

---

## 0. Base axios clients (module `2938`, file `chunks_3515-*.js`)

All created with `axios.create`. `M` = module `61199` (interceptors). `z` = adds `x-thndrx-runtime-version`. `m` = full-access auth interceptor. `x` = limited-access interceptor. `F(e,'body'|'header')` = firebase-token interceptor.

| Export | Var | baseURL | Auth injected | Notes |
|---|---|---|---|---|
| `aP` | `J` | `https://prod.thndr.app` | `m` → `Authorization: Bearer <FULL_ACCESS>` | main authed prod client |
| `Kc` | `ee` | `https://prod.thndr.app/krakend-thndr-x` | `m` (full access) | response uses `M.p4` (error-in-200 unwrap) |
| `kQ` | `et` | `https://prod.thndr.app` | `x` → `Bearer <LIMITED_ACCESS>` | limited-access client |
| **`pu`** | `er` | `https://prod.thndr.app` | **none** | **unauth** — email-code / login endpoints |
| **`th`** | `en` | `https://prod.thndr.app` | `F(e,'body')` → injects `{credentials:{firebase_token}}` into POST/PATCH/PUT body | firebase-in-body client |
| `hC` | `ea` | `/api` | `F(e,'header')` → `Bearer <FIREBASE>` | Next API w/ firebase header |
| **`Z$`** | `es` | `/api` (→ `https://x.thndr.app/api`) | **none** | **unauth** Next API — `/auth/login`, `/auth/refresh`, `/auth/logout` |
| `zC` | `ec` | `/api` | `m` (full access) | authed Next API |
| `VA` | `ei` | `https://therumble.app/api` | Rumble token | Rumble (out of scope) |
| `yS` | `eu` | `https://therumble.app/api` | none | Rumble unauth |

Request interceptor order for every client includes `M.Ff` (sets `X-Correlation-ID`, a UUID, + trace metadata) and most include `z` (`x-thndrx-runtime-version`).

---

## 1. Login methods

There are **three** identity methods, all producing a **Firebase** session. There is **NO email+password** and **NO email-link (`signInWithEmailLink`)** in this web app — the earlier assumption of an email-link flow is wrong; it is an **email OTP code** flow that returns a Firebase **custom token**.

Firebase config (module `38938`):
```js
apiKey: "AIzaSyCUbo98qRd0KJZbFLfNH0n4_v476vp7XFY",
authDomain: "thndr-api.firebaseapp.com",
databaseURL: "https://thndrx-realtime-db.europe-west1.firebasedatabase.app",
projectId: "thndr-api",
messagingSenderId: "639172574829",
appId: "1:639172574829:web:fffdf73e598f98d872c964"
```
Firebase SDK re-exports (module `34012`): `HF`=GoogleAuthProvider, `LD`=OAuthProvider, `xI`=getAuth, `p9`=getIdToken, `p`=**signInWithCustomToken**, `df`=signInWithPopup, `iZ`=**onIdTokenChanged**.

### 1a. Email OTP → Firebase custom token  (modules `58342`, `88037`, `8201`)
`chunks_app_auth_login_page-*.js` + `chunks_app_auth_verify-email_page-*.js`.

Step 1 — request code:
```
POST https://prod.thndr.app/auth-service/v2/users/email-code
Content-Type: application/json
{ "email": "<email>" }
→ 200 { "id": "<verification-id>" , ... }
```
Evidence (module 58342):
```js
sendVerificationCode: async ({email}) =>
  (await l.pu.post("/auth-service/v2/users/email-code", {email})).data
```
UI then routes to `/auth/verify-email?vid=<id>&email=<email>`. Resend countdown = 60 s (`Kv = 6e4`).

Step 2 — verify 6-digit code:
```
POST https://prod.thndr.app/auth-service/v2/users/login
Content-Type: application/json
{ "id": "<verification-id>", "code": "123456" }
→ 200 { "firebase_auth_token": "<FIREBASE CUSTOM TOKEN>" }
```
Evidence:
```js
verifyCode: async ({id, code}) =>
  (await l.pu.post("/auth-service/v2/users/login", {id, code})).data
...
let a = await S({id: M, code: e});
if (a?.firebase_auth_token) {
  await d.p(v.C(), a.firebase_auth_token);   // signInWithCustomToken(auth, token)
  T("/auth/2fa");
}
```
`signInWithCustomToken` logs the Firebase user in; the `onIdTokenChanged` listener (below) then stores the resulting Firebase **ID token**.

### 1b. Google OAuth  (module `88037`)
```js
async function O(){ let e=(0,S.C)(), t=new k.HF;          // getAuth(), GoogleAuthProvider
  let r=(await (0,k.df)(e,t)).user;                        // signInWithPopup
  let a=await (0,k.p9)(r);                                 // getIdToken
  return {user:r, token:a}; }
// onClick: (await O()).token && push("/auth/2fa")
```

### 1c. Apple OAuth  (module `88037`)
```js
async function E(){ let e=(0,S.C)(), t=new k.LD("apple.com"); // OAuthProvider("apple.com")
  let r=(await (0,k.df)(e,t)).user; let a=await (0,k.p9)(r);
  return {user:r, token:a}; }
// onClick: (await E()).token && push("/auth/2fa")
```

### Firebase ID token capture (module in `chunks_app_layout-*.js`, AuthGuard)
```js
let t = (0,D.iZ)((0,O.C)(), async t => {          // onIdTokenChanged(auth, cb)
  if (t) {
    let r = await t.getIdToken();
    if (store.getToken({type:FIREBASE}) !== r)
      store.setToken({type:FIREBASE, token:r, exp: decode(r).exp});
  }
});
```
So after *any* of 1a/1b/1c, the **Firebase ID token** is persisted in `localStorage["firebase_token"]` as `{token, exp}`.

---

## 2. 2FA — device approval + FULL_ACCESS exchange  (module `47297`, `chunks_app_auth_2fa_page-*.js`)

This is **not** an OTP/PIN typed into the web page. It is a **push/approval on the Thndr mobile app**: a token request is created, encoded into a QR code / deep link; the user approves it in the (already logged-in) mobile app; the web polls until approved, then swaps it for the full-access token.

### 2.1 Create token request
```
POST https://prod.thndr.app/auth-service/tokens/request        (client: th / en — firebase-in-body)
Content-Type: application/json
{
  "data": { "scopes": [ ... ] },
  "credentials": { "firebase_token": "<FIREBASE ID TOKEN>" }   // injected by interceptor F(e,'body')
}
→ 200 {
  "id": "<request_id>",
  "request_secret": "<secret>",
  "human_id": "<human_id>",
  "status": "...",
  ...
}
```
Evidence:
```js
async function k({data:e}){ return (await g.th.post("/auth-service/tokens/request",{data:e})).data }
async function N(){ return k({data:{scopes:w}}) }
```
Scope list `w` (requested on web):
```
notifications:read/write, assets:read/write, analysis:read, charts:read,
watchlist:read/write, market_depth:read, user:read/write, feed:read,
post:read/write, kyc_challenge:read/write, files:write, document:write,
subscription:read/write, market_simulator:read/write, order:read/write,
investor:read/write, market_egypt:read/write, funding:read/write
```
Unauth probe confirms the `credentials` requirement:
```
POST /auth-service/tokens/request  (no body creds) → 422
{"detail":[{"loc":["body","credentials"],"msg":"field required","type":"value_error.missing"}]}
```

### 2.2 User approval (QR / deep link) — module `50748` (`lazy_748.*.js`)
The web builds a deep link from the token request and renders it as a QR (desktop) or a button (mobile web):
```js
let a = new URLSearchParams({
  human_id: d.human_id,
  user_agent: navigator.userAgent,
  requestId: d.id
}).toString();
let f = `thndr://goToRoute?routeName=HUMAN_ID&${a}`;
```
Desktop: QR of `thndr://goToRoute?routeName=HUMAN_ID&human_id=…&user_agent=…&requestId=<id>` — the user **scans it with the Thndr mobile app** and approves. Mobile web: the `authenticate` button opens that deep link directly in the app. UI strings: `twoFactorAuth.checkApp`, `twoFactorAuth.scanQr`, `twoFactorAuth.appNotFound`.

### 2.3 Poll request status
```
POST https://prod.thndr.app/auth-service/tokens/request/<request_id>/status   (client: th / en)
Content-Type: application/json
{ "data": { "request_secret": "<secret>" },
  "credentials": { "firebase_token": "<FIREBASE ID TOKEN>" } }   // injected
→ 200 { "status": "pending" | "approved" | "claimed" , ... }
```
Evidence:
```js
async function j({request_id:e, request_secret:t}){
  return (await g.th.post(`/auth-service/tokens/request/${e}/status`,{data:{request_secret:t}})).data }
```
Polling (react-query `useQuery`):
- `refetchInterval` = **1000 ms**, `refetchIntervalInBackground: true`.
- Stops when `Date.now() > pollUntil` (now + `pollingPeriod` = **60 000 ms**) OR `status === "approved"` OR `status === "claimed"` (`v = "approved"`).
- A **retry window** (`retryDelay = 30 000 ms`) gates the "authenticate again" button.

### 2.4 Exchange for FULL_ACCESS + refresh cookie
When `status === "approved"`:
```
POST https://x.thndr.app/api/auth/login          (client: Z$ / es — Next route, withCredentials implicit via browser)
Content-Type: application/json
{
  "request_id":     "<request_id>",
  "request_secret": "<secret>",
  "firebase_token": "<FIREBASE ID TOKEN>",        // store.getToken({type:FIREBASE})
  "platform":       "thndrx_web"                  // or "thndrx_mobile"
}
→ 200 {
  "auth_token": "<FULL_ACCESS JWT>",
  "auth_token_expires_at": <...>,
  "refresh_token_expires_at": <...>
}
+ Set-Cookie: <httpOnly refresh cookie>   // set by the Next.js route; name NOT exposed in client JS
```
Evidence:
```js
async function E({request_id, firebase_token, request_secret, platform}){
  return (await g.Z$.post("/auth/login",{request_secret,firebase_token,request_id,platform})).data }
...
f = e => E({...e, platform: M ? "thndrx_mobile" : "thndrx_web"});
// on approved:
await ea({ request_id: Q.id, request_secret: Q.request_secret,
           firebase_token: b.L.getToken({type: b.k.FIREBASE}) });
```
On success (`onTokenReceived`):
```js
setToken({type: FULL_ACCESS, token, exp: Math.floor(Date.now()/1e3) + 15*60});   // 15 min
setRefreshTokenExp({exp: Date.now()/1e3 + 6*3600});                              // 6 hours
// → navigate to /workspaces/default/home (or /mobile/home)
```

**Timings / expiry**
- FULL_ACCESS lifetime: **15 min** (`15 * r0`, `r0 = 60`). Refreshed early at **3 min** before expiry (`ABOUT_TO_EXPIRE` = `3 * r0 = 180 s`).
- Refresh-token client-side expiry hint: **6 hours** (`6 * Jg`, `Jg = 3600`). (Authoritative lifetime is server-side on the httpOnly cookie; 6 h is what the client assumes.)
- FIREBASE / LIMITED_ACCESS: expiry taken from the JWT `exp` claim; no early-refresh window (`ABOUT_TO_EXPIRE` threshold 0).

---

## 3. Token refresh & lifetimes  (module `2938`)

### FULL_ACCESS refresh
```
POST https://x.thndr.app/api/auth/refresh      (client: es / Z$)
withCredentials: true                           (sends the httpOnly refresh cookie)
(no request body)
→ 200 { "auth_token": "<new FULL_ACCESS JWT>" }
```
Evidence:
```js
let {data:r} = await es.post("/auth/refresh", void 0, {withCredentials:true});
E.L.setToken({type:FULL_ACCESS, token:r.auth_token, exp: Math.floor(Date.now()/1e3)+15*60});
```
Driver logic (request interceptor `m`, error handler `_`):
- Token status machine: `NULL` → redirect `/auth/2fa`; `VALID` → attach bearer; `ABOUT_TO_EXPIRE` → fire background early refresh then proceed; `EXPIRED` → blocking refresh then retry (or logout).
- A connection probe `GET /api/ping` runs before a refresh; failure → `NETWORK_ERROR` (no logout).
- 401/403 responses → attempt refresh then **retry the original request** with the new bearer.
- Cross-tab single-flight via a Web Lock named `"thndrx:auth-refresh"`.
- Early-refresh retries on 429 with 60 s fixed backoff, max total wait 180 s.

### Refresh errors (logout triggers)
```js
let k = ["INVALID_REFRESH_TOKEN", "MISSING_REFRESH_TOKEN", "EXPIRED_REFRESH_TOKEN"];
// if error.response.data.type ∈ k → clearRefreshTokenExp() → logout → /auth/2fa
```
Confirmed by probe: `POST /api/auth/refresh` (no cookie) → **400** `{"type":"MISSING_REFRESH_TOKEN"}`.

### LIMITED_ACCESS  (module `2938`, fn `H`)
```
POST https://prod.thndr.app/auth-service/v2/tokens/limited-access     (client: th / en)
{ "credentials": { "firebase_token": "<FIREBASE ID TOKEN>" } }        // injected by F(e,'body')
→ 200 { "auth_token": "<LIMITED_ACCESS JWT>" }
```
Stored with exp = JWT `exp` claim. Used for endpoints that only need firebase-level auth.

### FIREBASE token refresh  (module `75633`)
`authStateReady()` → `currentUser.getIdToken()`; stored with JWT `exp`. Retries 2× / 5 s timeout.

### Logout  (module `54286`)
```
DELETE https://x.thndr.app/api/auth/logout        (client: Z$)   // clears httpOnly refresh cookie
```
Plus client clears all localStorage tokens + `firebase auth signOut()`.

---

## 4. Request signing / device ID / app-check / special headers

- **No request signing / HMAC.** None found.
- **No reCAPTCHA / Firebase App Check** initialized in app code (`initializeAppCheck`, `ReCaptchaEnterpriseProvider`, `ReCaptchaV3Provider` appear only inside the Firebase SDK bundle, never called by the app). The UUID `1923d036-45ad-480b-8c6b-1d1296862f6e` (const `zq`) is an **asset id** (e.g. `…/1923d036-…/COMI.png`), **not** a device id.
- **No custom device-id header.** "Device" identity is conveyed only by `platform: "thndrx_web"` in `/api/auth/login`, and `user_agent` in the approval deep link.
- Headers added to requests:
  - `x-thndrx-runtime-version: 3.8.3` (interceptor `z`, on nearly every client).
  - `X-Correlation-ID: <uuid>` (interceptor `M.Ff`, every client).
  - `Authorization: Bearer <token>` — FULL_ACCESS / LIMITED_ACCESS / FIREBASE depending on client. Special case: if a request sets flag header `authorizationAuth`, the scheme becomes `Authorization: Auth <FULL_ACCESS>` instead of `Bearer` (interceptor `I`).
  - `X-Language: ar|en` — only when a request sets the flag header `includeLanguageHeader`; value from `localStorage["locale"]`, default `"ar"`.
- Cloudflare sits in front of `prod.thndr.app` (sets `__cf_bm`); no Turnstile challenge was returned to a plain programmatic request. Vercel hosts `x.thndr.app/api`. CORS on `/api/auth/*`: `access-control-allow-credentials: true`, allowed origins include `https://x.thndr.app` and `http://localhost:3000`.

---

## 5. Response interceptors (module `61199`, `M.*`)

- **`M.Ff` (`i`)** — *request* interceptor: `headers.set("X-Correlation-ID", uuid())`; `metadata.trace_start = performance.now()`. (Not a response unwrapper.)
- **`M.r4` (`d`)** — response interceptor: **logs only, returns the response unchanged.** It does **NOT** unwrap `{data:…}` and does **NOT** convert snake/camel case. Consumers read `response.data` directly (raw server JSON, snake_case).
- **`M.p4` (`p`)** — response interceptor used **only on the krakend client** (`ee`): detects "error-embedded-in-200" responses where `response.data` contains one of a known set of keys (`error_price_alerts`, `error_asset_price`, …). If found it parses `value.http_body` → `.detail` (`{msg, type}`) and throws an `AxiosError` with `status = http_status_code`. Otherwise logs and returns unchanged. **No envelope unwrap, no case conversion.**
- **`M.lq` (`S`)** — shared error handler: downgrades 429 (for certain URLs) / cancellations to debug logs, otherwise logs error; always `Promise.reject`.

Conclusion: the client works directly with raw snake_case server JSON on `response.data`; there is no global envelope/case transform to replicate.

---

## 6. Token store (module `86489`) — reference for persistence

localStorage keys (each value = JSON `{token, exp}`; `exp` in epoch **seconds**):
`full_access_token`, `limited_access_token`, `firebase_token`, `rumble_token`, `rumble_refresh_token`, plus `refresh_token_expires_at` (epoch seconds, plain string).

```js
k = { FULL_ACCESS:"full_access", LIMITED_ACCESS:"limited_access",
      FIREBASE:"firebase", RUMBLE:"rumble", RUMBLE_REFRESH:"rumble_refresh" };
getTokenStatus: NULL | EXPIRED (exp<=now) | ABOUT_TO_EXPIRE (now>=exp-threshold) | VALID
  thresholds (s): full_access=180, rumble=180, others=0
```

---

## 7. Sequence diagram

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web (x.thndr.app)
    participant FB as Firebase (identitytoolkit, thndr-api)
    participant AS as prod.thndr.app/auth-service
    participant API as x.thndr.app/api (Next)
    participant APP as Thndr Mobile App

    Note over U,W: Stage 1 — Firebase identity (pick one)
    alt Email OTP
        W->>AS: POST /auth-service/v2/users/email-code {email}
        AS-->>W: {id}
        U->>W: enters 6-digit code
        W->>AS: POST /auth-service/v2/users/login {id, code}
        AS-->>W: {firebase_auth_token}  (custom token)
        W->>FB: signInWithCustomToken(custom token)
    else Google / Apple
        W->>FB: signInWithPopup(Google|Apple)
    end
    FB-->>W: Firebase user  (onIdTokenChanged → store firebase_token = ID token)

    Note over U,APP: Stage 2 — device approval 2FA
    W->>AS: POST /auth-service/tokens/request {data:{scopes}, credentials:{firebase_token}}
    AS-->>W: {id, request_secret, human_id, status}
    W-->>U: QR / deep link  thndr://goToRoute?routeName=HUMAN_ID&requestId=id&human_id&user_agent
    U->>APP: scan QR, approve in mobile app
    loop every 1s, up to 60s
        W->>AS: POST /auth-service/tokens/request/{id}/status {data:{request_secret}, credentials:{firebase_token}}
        AS-->>W: {status}
    end
    Note over W,AS: status == "approved"
    W->>API: POST /api/auth/login {request_id, request_secret, firebase_token, platform:"thndrx_web"}
    API-->>W: {auth_token, auth_token_expires_at, refresh_token_expires_at} + Set-Cookie: httpOnly refresh
    Note over W: store FULL_ACCESS (15 min); refresh cookie (~6h)

    Note over W,API: steady state
    loop ~every 15 min / on 401
        W->>API: POST /api/auth/refresh  (withCredentials; httpOnly cookie)
        API-->>W: {auth_token}
    end
    W->>API: DELETE /api/auth/logout   (on logout, clears cookie)
```

---

## 8. Recommended headless login strategy for the Node MCP server

The hard dependency is **Stage 2 device approval**: the full-access token can only be minted after a login request is **approved inside the user's Thndr mobile app**. That approval cannot be automated or bypassed (and must not be). Two viable strategies:

### Strategy A (recommended) — programmatic Firebase + CLI approval + persisted refresh
1. **Firebase identity via REST** (no browser):
   - Email OTP: `POST https://prod.thndr.app/auth-service/v2/users/email-code {email}` → `{id}`; prompt user for the code; `POST …/auth-service/v2/users/login {id, code}` → `{firebase_auth_token}`.
   - Exchange the custom token for an ID token via Firebase REST:
     `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCUbo98qRd0KJZbFLfNH0n4_v476vp7XFY`
     `{ "token": "<firebase_auth_token>", "returnSecureToken": true }` → `{ idToken, refreshToken, expiresIn }`.
   - Refresh the Firebase ID token when needed via `POST https://securetoken.googleapis.com/v1/token?key=<apiKey>` `grant_type=refresh_token&refresh_token=…`.
   - (Google/Apple OAuth are impractical headless — prefer email OTP.)
2. **Create token request**: `POST https://prod.thndr.app/auth-service/tokens/request` with body `{data:{scopes:[…]}, credentials:{firebase_token:<idToken>}}` and headers `x-thndrx-runtime-version: 3.8.3`, `X-Correlation-ID: <uuid>`. Get `{id, request_secret, human_id}`.
3. **Prompt the user to approve**: print the deep link `thndr://goToRoute?routeName=HUMAN_ID&requestId=<id>&human_id=<human_id>&user_agent=<ua>` and/or render it as a QR in the terminal; user approves in the mobile app.
4. **Poll** `POST …/auth-service/tokens/request/<id>/status` `{data:{request_secret}, credentials:{firebase_token}}` every ~1 s (cap ~60 s) until `status === "approved"`.
5. **Exchange** at the Next route: `POST https://x.thndr.app/api/auth/login {request_id, request_secret, firebase_token, platform:"thndrx_web"}`. Capture `auth_token` **and the `Set-Cookie` refresh cookie** (use a cookie jar — e.g. `tough-cookie`/`axios-cookiejar-support` — because the cookie is httpOnly and its name is not exposed; just persist whatever cookie the route sets).
6. **Persist** the refresh cookie jar; thereafter mint access tokens with `POST https://x.thndr.app/api/auth/refresh` (empty body, send cookie jar). FULL_ACCESS lasts 15 min; the refresh cookie ~6 h (re-run device approval when it expires / on `INVALID_REFRESH_TOKEN`/`MISSING_REFRESH_TOKEN`/`EXPIRED_REFRESH_TOKEN`).
7. **Authenticated calls**: `Authorization: Bearer <auth_token>`, `x-thndrx-runtime-version: 3.8.3`, `X-Correlation-ID: <uuid>`, optional `X-Language: en|ar`. Base URLs: `https://prod.thndr.app` (+ `/krakend-thndr-x`) and `https://x.thndr.app/api`.

### Strategy B (fallback) — paste tokens from browser DevTools
Have the user log in at `https://x.thndr.app` in a normal browser, then:
- Paste `localStorage["full_access_token"]` (JSON `{token,exp}`) for immediate use, and/or
- Paste the **refresh cookie** value (from DevTools → Application → Cookies for `x.thndr.app`) so the MCP server can call `/api/auth/refresh` itself and self-renew the 15-min access token.
This skips Firebase + device approval entirely for the MCP session and is the most robust bootstrap; Strategy A is the "native" path when the user hasn't got a browser session.

> Note: no app-check / captcha / signing is enforced on these endpoints for a plain client, so a Node http client (axios + cookie jar) is sufficient — no headless browser required. Cloudflare fronts `prod.thndr.app` but returned no challenge to plain requests; keep a realistic UA and the `x-thndrx-runtime-version` header.

---

## Appendix — endpoint quick reference

| Purpose | Method | URL | Auth | Body |
|---|---|---|---|---|
| Send email OTP | POST | `prod.thndr.app/auth-service/v2/users/email-code` | none | `{email}` |
| Verify OTP → custom token | POST | `prod.thndr.app/auth-service/v2/users/login` | none | `{id, code}` → `{firebase_auth_token}` |
| Limited access token | POST | `prod.thndr.app/auth-service/v2/tokens/limited-access` | firebase (body) | `{credentials:{firebase_token}}` → `{auth_token}` |
| Create 2FA token request | POST | `prod.thndr.app/auth-service/tokens/request` | firebase (body) | `{data:{scopes}, credentials:{firebase_token}}` → `{id, request_secret, human_id, status}` |
| Poll request status | POST | `prod.thndr.app/auth-service/tokens/request/{id}/status` | firebase (body) | `{data:{request_secret}, credentials:{firebase_token}}` → `{status}` |
| Exchange → FULL_ACCESS | POST | `x.thndr.app/api/auth/login` | none (uses firebase_token in body) | `{request_id, request_secret, firebase_token, platform}` → `{auth_token, auth_token_expires_at, refresh_token_expires_at}` + Set-Cookie |
| Refresh FULL_ACCESS | POST | `x.thndr.app/api/auth/refresh` | refresh cookie | (empty) → `{auth_token}` |
| Logout | DELETE | `x.thndr.app/api/auth/logout` | refresh cookie | — |
| Connection probe | GET | `x.thndr.app/api/ping` | none | — |
| Current user info | POST | `prod.thndr.app/auth-service/v2/users/info` | firebase (body) | → user object |

Probe-confirmed error shapes:
- `POST /api/auth/refresh` (no cookie) → `400 {"type":"MISSING_REFRESH_TOKEN"}`
- `POST /auth-service/tokens/request` (no creds) → `422 {"detail":[{"loc":["body","credentials"],"msg":"field required","type":"value_error.missing"}]}`
