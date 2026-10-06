# 0020. Apache-2.0 license and a liability disclaimer

- Status: Accepted
- Date: 2026-10-06

## Context

thndr-mcp reads people's brokerage accounts and feeds AI assistants that may draw wrong conclusions; it may add order
placement later (ADR 0019). The maintainer wants to minimise legal exposure for financial decisions and losses. A
legal-research pass (not legal advice) compared licenses and disclaimers of comparable projects (Freqtrade, yfinance,
ib_async, Alpaca's MCP server) and the relevant law: Egyptian law lets contractual liability be waived except for
gross negligence or fraud but not liability in tort; the EU Product Liability Directive 2024/2853 excludes free
software supplied outside a commercial activity; US law treats impersonal, non-tailored information differently from
personal advice. The project had a single author, so it could be relicensed freely.

## Decision

- We relicense from MIT to the **Apache License 2.0**, unmodified: its warranty disclaimer and limitation of liability
  (sections 7–8) are more explicit, section 9 makes anyone offering extra warranties indemnify the contributors,
  section 5 covers contributions, section 6 grants no trademark rights, and section 3 adds a patent grant.
- We add no custom terms to the license. Instead, `NOTICE` (carried with redistributions, informational only) states
  that the project is unofficial and gives no financial advice, and `DISCLAIMER.md` holds the full disclaimer: not
  affiliated, not financial advice, AI output can be wrong, "AS IS" with no liability to the extent the law allows,
  the user's own responsibility for Thndr's terms and local law, interoperability, privacy.
- The disclaimer appears in full in the README, and in a short form in the CLI help, at the start of `thndr login`, in
  the MCP server instructions (which also tell assistants to present information, not personalised advice) and on the
  browser login page. CONTRIBUTING and SECURITY repeat the rules that matter (no Thndr code or secrets, no advice, no
  money operations without an ADR).
- We avoid wording such as "official", "guaranteed", "safe", "advice", "recommendation" or "signals", and say
  "currently read-only".

## Consequences

- Stronger, standard protection for the maintainer and contributors; a disclaimer reduces but cannot remove liability
  (never for fraud, gross negligence or wilful misconduct), so a lawyer should review it, especially before any write
  feature ships.
- Downstream users must keep `LICENSE` and `NOTICE` when redistributing.
