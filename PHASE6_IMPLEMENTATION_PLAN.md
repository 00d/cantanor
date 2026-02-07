# Phase 6 Implementation Plan

This plan defines the first gameplay-breadth phase after Phase 5 engine hardening.

## Phase 6 Goal

Build a playable browser-facing tactical gameplay loop by adding execution pipelines for player-facing content (actions, spells, feats, items) on top of the deterministic core runtime.

## Scope

In scope:
- Action execution framework beyond hazard-centric flows
- Spell/feat/item runtime adapters (data-driven where possible)
- Trait-aware targeting and rule interaction hooks
- Forecast payload generation for UI command previews
- Encounter-side policy baseline for non-scripted enemy turns
- Browser integration contract for command submission + replay/event feed

Out of scope (Phase 7+):
- Full content parity with entire PF2e corpus
- Production multiplayer transport/auth
- Advanced progression/campaign systems
- Full asset/animation pipeline polish

## Deliverables

1. Content execution kernel
- Unified action resolution path for `strike`, `cast_spell`, `use_feat`, `use_item`, and `interact` style commands.
- Shared precondition checks: traits, range, targets, resource costs, action cost.

2. Rule interaction layer
- Trait/tag resolver for common interaction gates (immunity, resistance hooks, targeting constraints).
- Explicit precedence rules for mixed-effect packets (damage + condition + movement).

3. Forecast and UX contracts
- Deterministic forecast payloads for hit/save odds, expected damage bands, and status outcomes.
- Stable JSON shape for browser HUD/preview consumption.

4. Scenario and AI baseline
- Policy-driven enemy turn executor (simple tactical policy, deterministic tie-breaks).
- Regression scenarios covering non-scripted tactical rounds.

5. Verification and regression gates
- Phase 6 regression matrix with locked replay hashes.
- Contract tests for command validation and forecast payload schemas.

## Data Contracts

Inputs:
- `compiled/tactical_engine_rules_v1.json`
- `compiled/tactical_effect_models_v1.json`
- Future versioned content bundles (book-scoped or feature-scoped packs)

Runtime contracts:
- `Command` discriminated variants for gameplay commands (`cast_spell`, `use_feat`, etc.)
- `Event` entries with normalized execution metadata and forecast traces
- `Forecast` payload contract for browser command previews

Output:
- `BattleResult` with final state, event log, replay hash, and optional forecast snapshots

## Test Gates

Gate 1: Contract strictness
- Scenario loader enforces required fields for new command variants.
- Invalid target/resource/action-cost states fail with deterministic `command_error` payloads.

Gate 2: Rules correctness
- Trait interactions and mixed-effect precedence matrix green.
- Forecast payload values match executed outcomes for deterministic scenarios.

Gate 3: Determinism
- Replay hash stability across repeated runs for all Phase 6 regression scenarios.

Gate 4: Browser contract stability
- Forecast/event schemas remain backward compatible within phase.

Gate 5: Performance baseline
- Phase 6 regression suite completes under local dev budget.

## Milestones

M6.1: Command variants + validation
- Exit criteria: new gameplay command types validated and routed through reducer.

M6.2: Execution adapters (spell/feat/item baseline)
- Exit criteria: representative commands execute with deterministic outcomes and events.

M6.3: Forecast contract
- Exit criteria: preview payload emitted and covered by contract tests.

M6.4: Enemy policy baseline
- Exit criteria: deterministic non-scripted encounter rounds execute with no command errors.

M6.5: Regression lock
- Exit criteria: Phase 6 matrix hashes generated and enforced in CI/local suite.

## Immediate Next Actions

1. Add command schema variants for `cast_spell`, `use_feat`, and `use_item`.
2. Implement reducer handlers with shared validation helpers.
3. Add forecast payload builder for strike and one spell archetype.
4. Create `scenarios/smoke/phase6_*` set plus `scenarios/regression_phase6/expected_hashes.json`.
5. Add `tests/scenarios/test_phase6_regression_matrix.py` and forecast contract tests.
