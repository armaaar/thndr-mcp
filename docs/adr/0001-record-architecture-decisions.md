# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-10-06

## Context

thndr-mcp integrates with an undocumented, private API that can change without notice. Future contributors need
to understand *why* things are built the way they are — especially where we deliberately mirror (or avoid) the
behaviour of Thndr's own clients.

## Decision

We will keep Architecture Decision Records in `docs/adr/`, numbered sequentially, using `template.md`.

## Consequences

- Decisions are discoverable and reviewable in pull requests.
- Superseding a decision requires a new ADR, keeping history intact.
