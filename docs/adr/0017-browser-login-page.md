# 0017. Browser login page for login on demand

- Status: Accepted
- Date: 2026-10-06
- Refines: [0016](0016-login-on-demand-via-mcp-elicitation.md) (how the user is asked; login on demand itself stays)

## Context

ADR 0016 asked the user for the email, the code and the phone approval through MCP form elicitation. Testing it in
Claude Code showed two problems:

- Thndr sends **no push notification** for a web login. ThndrX shows the approval deep link as a **QR code** that
  the phone scans; the user needs to see that QR code.
- Claude Code collapses long elicitation messages to their first lines ("… (+24 more lines)"), so a QR code drawn in
  text never reaches the user, and some clients (Claude Desktop, for example) may not support elicitation at all.

## Decision

We will run the whole login in a **local browser page**:

- When a tool needs a session (ADR 0016), the MCP server starts a small HTTP server on `127.0.0.1` (random port) and
  opens `http://127.0.0.1:<port>/<token>/` in the default browser (`open`, `xdg-open`, `rundll32
  url.dll,FileProtocolHandler` on Windows, or the Windows browser via `explorer.exe` under WSL). The page asks for the email, then the code, then shows the approval **QR
  code** (SVG) with the request number, and reports progress until the login completes — no "Accept" step.
- The page is one more `LoginDialog` for the shared guided login (`presentation/browser/browser-login.ts` drives
  `runGuidedLogin`), so the steps and messages are the same as `thndr login`. A failed attempt can be retried on the
  page; the page can cancel; it closes 15 minutes after it opened, or 30 seconds after the login ended. Cancelling (or
  expiry) also stops the guided login behind the page: it waits for the approval in 10-second steps and checks for
  cancellation between steps, and a new login starts only after the previous one stopped (they share the login flow).
- Only the tool call that started the login can show the prompt; concurrent calls join it silently.
- The tool call waits for the page. The server **always opens the page itself**. We do not use MCP URL elicitation:
  Claude Code implements it as an "open this URL?" consent prompt, and declining it cancelled the login — an extra
  step the user does not want. The link is shown in a form prompt **only when the browser could not be opened**:
  Claude Code does not close a prompt that the server cancels, so a prompt shown next to the open page outlived the
  login. Whatever the user answers there only hides the link; the page has its own Cancel. MCP progress notifications
  (every 15 s) always carry the link.
- A tool call the client cancels or times out leaves the page running; the user finishes and asks again.
- Security of the page: the URL carries a 192-bit random token; only `127.0.0.1`/`localhost` `Host` headers are
  served (DNS rebinding); state-changing requests must be same-origin `application/json` (no cross-site form posts);
  bodies are capped at 2 KB; responses are `no-store` with `Referrer-Policy: no-referrer`; the page has a strict CSP
  (nonce-only inline script, `font-src 'self'`) and loads **nothing from the internet**: its font is served by the
  page itself.
- `thndr login` keeps the terminal dialog (a terminal can show the QR code drawn with half blocks). The model-driven
  `login_*` tools stay as the fallback for machines without a browser.
- The page follows **Thndr's brand** as shown by its logo, app and App Store listing: bright yellow `#ffff00` with
  black, rounded cards and pill buttons, green for success (ThndrX's web stylesheet uses an indigo accent, but the brand
  colour is yellow). Light: an off-white page, a white card and yellow pill buttons; dark: a near-black page, a dark
  card and yellow pill buttons. It adapts to phone screens, strips pasted whitespace from the email and code fields,
  and every text colour meets WCAG AA. It follows the system theme until a header button pins light or dark for that
  page (nothing is stored: each login runs on a new port). Typography is DM Sans, as on ThndrX, bundled from
  `@fontsource-variable/dm-sans` (SIL Open Font License) and served at `font.woff2`; if it is missing, the system font
  is used. It uses no Thndr logo and says, in the header and in the card next to the form, that it is unofficial and
  not affiliated with Thndr, that everything runs locally and no data is collected, and that the email and code go
  only to thndr-mcp on this machine, which sends them straight to Thndr.
- To keep the QR code small, the deep link's `user_agent` parameter carries a short device name
  (`THNDR_DEVICE_NAME`, default `thndr-mcp`).

## Consequences

- Works in any MCP client that runs local stdio servers (Claude Code, Claude Desktop, …), with or without elicitation.
- The email and code go from the browser to this process only; they never reach the MCP client or the model.
- Needs a browser on the machine running the server. Over SSH or in a container the link is still shown, but
  `127.0.0.1` must be forwarded; `thndr login` in a terminal remains the simplest fallback there.
- The server now listens on a loopback port while a login is in progress. The token, host and origin checks keep
  other local web pages from driving it; other local processes of the same user are outside the threat model (they
  could read the session file anyway).
- The page works offline up to the calls to Thndr and tells no third party that the user is logging in.
- The QR code needs no explanation in a dialog that may truncate it, and the user does not have to come back and press
  Accept: the page and the tool call both see the approval directly.
