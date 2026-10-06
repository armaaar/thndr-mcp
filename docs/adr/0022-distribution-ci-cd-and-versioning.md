# 0022. Distribution, CI/CD and versioning

- Status: Accepted
- Date: 2026-10-06

## Context

thndr-mcp is going public on GitHub. Publishing to npm has to wait (the maintainer lost access to the npm account), so
people must be able to run the MCP server and the CLI from GitHub alone. The project needs automated checks on every
change, releases with meaningful versions and a changelog, and a publishing path that turns npm on later without
redesign. Commits already follow Conventional Commits (CLAUDE.md).

## Decision

- **Distribution from GitHub.** `package.json` builds on install (`prepare: tsup`), so `npx -y github:armaaar/thndr-mcp`
  (the `main` branch) and `github:armaaar/thndr-mcp#vX.Y.Z` (a release) work without cloning. Every GitHub Release also
  carries the prebuilt package (`thndr-mcp-X.Y.Z.tgz` plus its SHA-256), which `npx` can run directly without a build.
- **Versioning.** Semantic Versioning, starting at `0.1.0`. `package.json` is the source of truth; `src/version.ts`
  (shown by the CLI and the MCP server) is updated with it and a test fails if they differ. While `0.x`, `feat` and
  breaking changes bump the minor and `fix`/`perf` the patch.
- **Releases by pull request.** release-please (`.github/workflows/release.yml`, `release-please-config.json`,
  `.release-please-manifest.json`) keeps a release PR with the next version and the generated `CHANGELOG.md`. A human
  merges it to release; that creates tag `vX.Y.Z` and the GitHub Release, then the publish job re-runs the checks on
  the tag, verifies the tag matches `package.json`, packs and attaches the package.
- **npm later.** The publish job's `npm publish --provenance --access public` step runs only when an `NPM_TOKEN`
  secret exists; adding the secret enables npm publishing with no other change.
- **CI** (`.github/workflows/ci.yml`) on every pull request and push to `main`: `npm run check` (typecheck, lint, tests
  with the 95 % coverage gate) and the build on Node 20 and 22, then a smoke test that packs the package, installs the
  tarball in a fresh project and runs `thndr help` and `thndr-mcp`. CI uses no secrets and never calls Thndr.
- **Dependabot** proposes weekly dependency and action updates as `chore(deps)` / `chore(ci)` commits, which do not
  bump the version.

## Consequences

- Users install with one command and can pin a version; releases are deliberate (a merged PR) yet need no manual
  version edits.
- Installing from a git URL builds locally (it needs the dev dependencies and takes a few seconds); the release tarball
  avoids that.
- The repository must allow GitHub Actions to create pull requests (release-please). Commit messages now drive the
  version, so their type matters.
