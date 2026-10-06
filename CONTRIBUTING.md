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
  a breaking change bumps the major. `docs`, `chore`, `test`, `refactor` and `ci` commits do not trigger a release and
  stay out of the CHANGELOG.
- The first release is `0.1.0`: release-please opens it as its first release pull request after the first push to
  `main` (its CHANGELOG covers the whole history so far).
- CI runs `npm run check`, the build and a packaging smoke test on every pull request; it must pass before merging. The
  release pull request is the exception: release-please opens it with the workflow token, which does not trigger CI —
  it only changes the version (`package.json`, `package-lock.json`, `src/version.ts`, `.release-please-manifest.json`)
  and the CHANGELOG, and the publish job re-runs every check on the tag.
- If the publish job fails after the release was created (the Release exists without its package), fix the cause on
  `main`. A re-run of the failed job only helps when the cause is outside the tagged tree (e.g. a flaky runner): the job
  checks out the tag, so a problem inside it fails again. Otherwise attach the package by hand from the tag:
  `git checkout vX.Y.Z && npm ci && npm pack && sha256sum thndr-mcp-X.Y.Z.tgz > thndr-mcp-X.Y.Z.tgz.sha256 &&
  gh release upload vX.Y.Z thndr-mcp-X.Y.Z.tgz thndr-mcp-X.Y.Z.tgz.sha256`.
