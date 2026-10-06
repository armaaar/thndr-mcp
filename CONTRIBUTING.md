# Contributing

Thanks for helping with thndr-mcp, an unofficial community project (see [DISCLAIMER.md](DISCLAIMER.md)).

- **License.** Contributions are accepted under the project license, the [Apache License 2.0](LICENSE) (section 5):
  by submitting a change you license it under the same terms.
- **No Thndr apps or private data.** Never commit Thndr's bundles, decompiled code or app packages (quote only the
  short excerpts `docs/api` needs to describe an endpoint), tokens,
  refresh tokens, cookies, session files or personal account data. Fixtures must be synthetic or redacted.
- **Money stays out of scope.** thndr-mcp is currently read-only for money: no tool may place, modify or cancel orders
  or move funds without a new ADR that supersedes [ADR 0006](docs/adr/0006-trading-safety.md). Write endpoints may be
  documented ([ADR 0019](docs/adr/0019-document-write-operations.md)), not implemented.
- **No advice.** Tool descriptions and outputs present information; they must not claim to give investment advice or
  recommendations, or describe the tool as official, guaranteed or safe.
- **How we work.** Follow [CLAUDE.md](CLAUDE.md): the five-layer architecture, tests next to the code, `npm run check`
  before every commit (coverage above 95%), Conventional Commits, and an independent review before merging. Record
  architectural decisions as ADRs in [docs/adr](docs/adr/README.md).
