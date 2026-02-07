# Phase 8 Implementation Plan

This phase begins post-Phase-7 expansion focused on pack-driven gameplay execution and browser-ready command composition.

Status: In progress as of February 7, 2026 (M8.1 complete).

## Phase 8 Goal

Move from pack metadata integration to pack-driven command execution so scenarios and browser clients can issue compact intents that are materialized into deterministic runtime commands.

## Scope

In scope:
- Content-entry command templating for `cast_spell`, `use_feat`, `use_item`, and `interact`
- Scenario-level phase pinning for compatibility gates (`engine_phase`)
- Deterministic runtime error path for invalid content-entry mappings
- Smoke/contract coverage for template materialization and mismatch handling

Out of scope (Phase 9+):
- Full build/progression graph execution
- Advanced tactical AI search
- UI asset/animation production
- Networked multiplayer/session persistence

## Deliverables

1. Pack-driven command materialization
- Runtime adapter that merges content-pack entry payload templates into commands using `content_entry_id`
- Entry/command-type mismatch detection before reducer execution
- Auto-derived command IDs when omitted (`spell_id`, `feat_id`, `item_id`, `interact_id`)

2. Scenario contracts for phase evolution
- Optional scenario `engine_phase` field controlling compatibility checks
- Validation updates for compact template-friendly command shapes

3. Verification coverage
- Phase 8 smoke scenarios for pack-template cast spell and feat usage
- Scenario tests validating positive and negative materialization flows

## Test Gates

Gate 1: Template correctness
- Pack-template commands execute with no `command_error` and preserve deterministic outputs.

Gate 2: Error determinism
- Mismatched `content_entry_id` and command type yields deterministic `command_error` payload.

Gate 3: Backward safety
- Existing explicit-command scenarios continue to run without behavior regressions.

## Milestones

M8.1: Content-entry template baseline (complete)
- Exit criteria: runtime materialization + compact command validation + smoke/tests.

M8.2: Pack-driven enemy policy actions
- Exit criteria: enemy policy can select configured pack-template actions with deterministic tie-breaks.

M8.3: Regression lock
- Exit criteria: phase 8 matrix and expected hashes enforced.

## Immediate Next Actions

1. Extend `enemy_policy` action set to include template-driven spell/feat decisions.
2. Add phase 8 regression matrix (`scenarios/regression_phase8`) with expected hashes.
3. Expand browser-facing event payloads for policy rationale and template source trace.
