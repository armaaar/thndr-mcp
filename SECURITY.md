# Security

## Reporting a vulnerability

Please report security issues privately to the maintainer (armaaar) rather than in a public issue, with steps to
reproduce. You will get an acknowledgement as soon as possible; there is no bug bounty.

## How thndr-mcp handles your account

- It runs on your computer and sends nothing to the maintainers.
- Your Thndr session (access and refresh tokens) is stored in `~/.config/thndr-mcp/session.json`, or in
  `THNDR_SESSION_FILE`, readable only by your user (mode 0600). Anyone who can read that file can act on your Thndr
  account: protect it like a password, and run `thndr logout` (or the `logout` tool) to delete it.
- The browser login page listens on `127.0.0.1` only, behind a random 192-bit token, while a login is in progress
  ([ADR 0017](docs/adr/0017-browser-login-page.md)).
- Logs never contain tokens, cookies or the session file.

thndr-mcp is provided "AS IS", without warranty (see [LICENSE](LICENSE) and [DISCLAIMER.md](DISCLAIMER.md)).
