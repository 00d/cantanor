# Phase 9 Implementation Plan

This phase begins after Phase 8 completion and targets browser command-authoring contracts plus tactical policy explainability.

Status: In progress as of February 7, 2026 (M9.1 and M9.2 complete).

## Phase 9 Goal

Provide deterministic, browser-facing authoring contracts so UI layers can build valid gameplay commands directly from content-entry catalogs without duplicating runtime rule logic.

## Scope

In scope:
- UI command-authoring catalog for template-capable entries
- Deterministic command-intent builder for `cast_spell`, `use_feat`, `use_item`, and `interact`
- Contract validation for intent shape and entry/type mismatch handling
- Scenario result payload exposing authoring catalog for browser clients

Out of scope (Phase 10+):
- Full UI renderer and client state management
- Multiplayer transport/session semantics
- Large-scale tactical policy search

## Deliverables

1. Command-authoring API baseline
- `engine/io/command_authoring.py` with option listing and intent-building helpers.
- Strict deterministic errors for malformed actor/target/DC and entry mismatch.

2. Browser-facing runtime contract
- `run_scenario` result includes `command_authoring_catalog` for UI builders.

3. Verification
- Contract tests for authoring APIs.
- Scenario-level assertion for catalog emission stability.

## Milestones

M9.1: Command-authoring baseline (complete)
- Exit criteria: catalog + intent builder + tests + scenario payload exposure.

M9.2: Tactical policy rationale payloads (complete)
- Exit criteria: richer policy decision trace with deterministic rationale fields.

M9.3: Regression lock
- Exit criteria: phase 9 matrix and expected hashes enforced.

## Immediate Next Actions

1. Create `scenarios/regression_phase9` and lock hashes after rationale payload contracts stabilize.
2. Expand UI command authoring coverage to include move/strike direct-intent helpers.
3. Add policy rationale parity across all policy action families and fallback paths.
