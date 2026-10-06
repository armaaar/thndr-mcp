# 0013. Persisted login flow and a session shared by all processes

- Status: Accepted
- Date: 2026-10-06
- Refines: [0007](0007-authentication-and-session.md)

## Context

With a CLI, every login step (`thndr login-start`, `thndr login-verify-code`, `thndr login-complete`) is a separate
process, and the MCP server may restart between steps. The pending login (email verification id, device-approval
request id and secret) was held in memory. The CLI and MCP server also run concurrently on the same machine, and a
token refresh in one rotates the refresh cookies the other uses.

## Decision

- The `LoginFlow` aggregate gets a domain repository, `LoginFlowRepository`. The production implementation stores it
  in the same owner-only session file (`loginFlow` section). An in-memory implementation exists for tests.
- `SessionFile` no longer caches. Every read goes to disk, and writes stay atomic (temp file + rename, 0600). Any
  process therefore sees the latest refresh cookies and the latest login state.
- Both delivery mechanisms use the same session file (`THNDR_SESSION_FILE` or `~/.config/thndr-mcp/session.json`).
  Logging in through either one logs in both.

## Consequences

- Multi-step logins work from the CLI and survive MCP restarts.
- The request secret of a pending approval is persisted; it is short-lived and protected like the refresh cookie.
- Two processes refreshing at exactly the same moment could both refresh. That is harmless: the last write wins and
  both tokens are valid.
