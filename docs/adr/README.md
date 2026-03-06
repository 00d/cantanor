# Architecture Decision Records

This directory holds Architecture Decision Records — permanent documentation of
design choices that shape the codebase. ADRs are for decisions that:

- Close off a design direction permanently (not just "defer to a later phase")
- Have non-obvious rationale that future maintainers need to understand
- Were made after comparing concrete alternatives

Forward-looking work lives in [`../../ROADMAP.md`](../../ROADMAP.md). ADRs are
for decisions that *won't* appear on the roadmap because they've been ruled out.

## Format

Each ADR follows a lightweight template:

- **Status** — Proposed / Accepted / Superseded
- **Context** — What situation prompted this decision
- **Decision** — What was decided
- **Rationale** — Why, including the specific constraints that forced the choice
- **Consequences** — What this enables, what it prevents, what was salvaged
- **Alternatives considered** — What else was evaluated and why it was rejected

## Index

| # | Title | Status |
|---|---|---|
| [001](001-no-undo.md) | No undo system | Accepted |
