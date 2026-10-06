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

## Versions and releases

- Versions follow [Semantic Versioning](https://semver.org) and are cut by
  [release-please](https://github.com/googleapis/release-please) from commit messages ([ADR
  0022](docs/adr/0022-distribution-ci-cd-and-versioning.md)): it keeps a "release" pull request open with the next
  version and the CHANGELOG. Merging that pull request tags `vX.Y.Z`, creates the GitHub Release and attaches the built
  package. Never edit `package.json`'s version, `src/version.ts` or `CHANGELOG.md` by hand.
- Your commit type decides the bump. While the version is `0.x`: `feat` → minor (`0.1.0` → `0.2.0`), `fix` and `perf`
  → patch (`0.1.0` → `0.1.1`), and a breaking change (`feat!:` or a `BREAKING CHANGE:` footer) → minor too. From `1.0.0`
  a breaking change bumps the major. `docs` appear in the CHANGELOG without a bump of their own; `chore`, `test`,
  `refactor` and `ci` are hidden.
- CI runs `npm run check`, the build and a packaging smoke test on every pull request; it must pass before merging.

