# 0016. Login on demand via MCP elicitation

- Status: Accepted
- Date: 2026-10-06

## Context

Remote MCP servers such as the IBKR connector authorise before any tool runs: the MCP client performs OAuth against
the broker and the user signs in on the broker's own page. That model does not fit thndr-mcp:

- Thndr has no OAuth authorisation server. Its only login is an email one-time code followed by an approval in the
  Thndr mobile app (ADR 0007).
- thndr-mcp is a local **stdio** server, and the MCP authorisation specification only covers HTTP transports.

Until now, the model drove the login with the `login_*` tools, so the user had to type their email and one-time code
into the chat, and the code passed through the model's context. Hosting our own OAuth authorisation server in front of
the Thndr login (a local HTTP transport plus authorize/token/registration endpoints) would mimic IBKR, but it is a
large surface to build and secure for one user on one machine.

MCP **form elicitation** lets a server ask the user for structured input in the client's own UI during a request.

## Decision

We will log in **on demand** through MCP elicitation:

- When a tool fails with `NOT_AUTHENTICATED` or `SESSION_EXPIRED` and the client declares form elicitation, the MCP
  server runs the guided login itself and then retries the tool once. It asks for the Thndr email, then the emailed
  code, then shows the phone-approval instructions (request number and deep link) and waits for the user to confirm.
  When the account is still identified (session expired), only the approval is asked for.
- The flow is the same **guided login** as `thndr login`: `presentation/presenters/guided-login.ts` runs the identity
  use cases (`auth_status` → `login_start` → `login_verify_code` | `login_request_approval` → `login_complete`)
  through `runAndPresent` and talks to the user through a `LoginDialog`. The CLI implements it with terminal prompts,
  the MCP server with elicitation (`presentation/mcp/login-on-demand.ts`). No new use case and no new domain logic.
- Identity tools never trigger it, concurrent tool calls share one login, and each question waits up to 10 minutes.
- If the user declines or the login fails, the tool returns its original error with a `login` field explaining why.
- Clients without elicitation keep today's behaviour: the error, and the step-by-step `login_*` tools.

## Consequences

- The email and one-time code go from the user straight to the server and never enter the model's context.
- "Just ask for your portfolio" works from a logged-out state, close to the IBKR experience, without OAuth.
- Login is still lazy: the server starts and lists its tools without a session; the first tool that needs Thndr asks.
- The MCP and the CLI keep exposing exactly the same use cases (ADR 0012); login on demand is delivery-mechanism
  behaviour in the presentation layer, shared with `thndr login` through the `LoginDialog` port.
- It depends on the client supporting form elicitation; the UI (and how long the client waits for a tool call while the
  user reads their email) is the client's. Without it, nothing changes.
