# Phase 7 Implementation Plan

This plan defines the first post-Phase-6 expansion phase focused on production-grade content breadth and runtime integration.

## Phase 7 Goal

Establish a versioned content-pack pipeline and broaden gameplay execution so browser-facing systems can consume stable, compatibility-scoped mechanics bundles.

## Scope

In scope:
- Versioned content-pack contract and loader validation
- Pack compatibility metadata (engine-phase and feature tags)
- Content normalization pass for action/spell/feat/item entries
- Interact-style command baseline (`interact`) for non-combat utility actions
- Expanded scenario coverage for mixed scripted + policy-driven turns

Out of scope (Phase 8+):
- Full PF2e parity and campaign progression systems
- Advanced AI tactical planning/search trees
- Multiplayer transport/auth and persistence infrastructure
- Asset-heavy UI production polish

## Deliverables

1. Content-pack foundation
- `content_pack` schema + runtime validator for versioned bundles
- Loader contracts for normalized entries and compatibility gates
- Sample baseline pack proving loader and schema behavior

2. Runtime breadth expansion
- `interact` command variant with deterministic validation and events
- Additional feat/item/spell packet patterns for non-damage outcomes

3. Integration contracts
- Browser-facing payload shape for content-pack metadata and entry lookup
- Stable compatibility checks before scenario execution

4. Regression and verification
- Phase 7 regression matrix with locked replay hashes
- Contract tests for content-pack validation and compatibility resolution

## Data Contracts

Content-pack top-level:
- `pack_id`: unique stable identifier
- `version`: semantic version string (`MAJOR.MINOR.PATCH`)
- `compatibility`: phase bounds + feature tags
- `entries`: normalized action/spell/feat/item definitions

Runtime integration:
- Scenario may reference a `content_pack_id` in future milestones
- Loader resolves and validates pack compatibility before execution

## Test Gates

Gate 1: Content-pack strictness
- Loader rejects malformed version, duplicate entry IDs, and invalid compatibility bounds.

Gate 2: Runtime correctness
- Interact and expanded content commands run without `command_error` in smoke scenarios.

Gate 3: Determinism
- Phase 7 regression scenarios maintain stable replay hashes.

Gate 4: Integration stability
- Content-pack lookup + compatibility checks are deterministic and backward-safe.

## Milestones

M7.1: Content-pack contract baseline
- Exit criteria: schema + loader + contract tests + sample pack are in repo.

M7.2: Interact command baseline
- Exit criteria: reducer path + validation + smoke scenario + tests.

M7.3: Pack-aware scenario integration
- Exit criteria: scenario-level pack resolution and compatibility checks.

M7.4: Regression lock
- Exit criteria: phase7 matrix and expected hashes enforced by test gate.

## Immediate Next Actions

1. Add `engine/io/content_pack_loader.py` with strict validation and compatibility helpers.
2. Add `engine/io/schemas/content_pack.schema.json` for external tooling alignment.
3. Add `corpus/content_packs/phase7_baseline_v1.json` sample bundle.
4. Add `tests/contract/test_content_pack_loader.py` covering validation edge cases.
5. Begin M7.2 by adding `interact` command variant contracts.
