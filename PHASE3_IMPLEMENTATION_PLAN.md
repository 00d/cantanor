# Phase 3 Implementation Plan

This plan defines the first engine-grade implementation phase for a browser tactical RPG simulation core.

## Phase 3 Goal

Build a deterministic tactical combat runtime that can execute encounters from normalized rules data and produce replayable battle logs.

## Scope

In scope:
- Turn order and round progression
- Action economy (actions/reaction)
- Grid movement and occupancy
- Targeting primitives (single target, area)
- Save/check resolution and degree-of-success outcomes
- Effect application lifecycle (apply/tick/expire)
- Deterministic event log + replay hash
- Scenario runner for automated test battles

Out of scope (Phase 4+):
- Full class/feat/spell content breadth
- Advanced AI planner depth
- Production frontend polish
- Multiplayer transport/auth

## Deliverables

1. Engine kernel and state model
- Immutable-ish battle state transitions (`reduce(state, command) -> state`)
- Canonical IDs for units, effects, tiles, actions

2. Deterministic resolver
- Seeded RNG interface
- Check/save resolver with critical success/failure handling
- Damage/condition resolver

3. Effect system
- Effect handlers with lifecycle hooks: `on_apply`, `on_turn_start`, `on_turn_end`, `on_expire`
- Duration handling and stack policy

4. Grid + targeting
- Tile occupancy, movement cost, blocked cells
- Line/radius/cone targeting helpers
- LOS/LOE baseline rules

5. Scenario runner
- CLI to run scenario JSON and emit structured event log
- Replay verifier (same seed + commands => same hash)

6. Verification suite
- Contract tests for rules math
- Determinism tests
- Regression scenario tests

## Proposed File Structure

```text
engine/
  __init__.py
  core/
    state.py
    ids.py
    commands.py
    reducer.py
    turn_order.py
    rng.py
  rules/
    checks.py
    saves.py
    damage.py
    conditions.py
    degrees.py
  grid/
    map.py
    movement.py
    los.py
    loe.py
    areas.py
  effects/
    base.py
    registry.py
    handlers/
      damage.py
      condition.py
      movement.py
      summon.py
  io/
    scenario_loader.py
    rules_loader.py
    event_log.py
  cli/
    run_scenario.py
tests/
  contract/
    test_checks_and_saves.py
    test_damage_and_conditions.py
    test_targeting_areas.py
  determinism/
    test_replay_hash.py
  scenarios/
    test_sample_hazard_scenarios.py
scenarios/
  smoke/
    hidden_pit_basic.json
    fireball_rune_basic.json
    poisoned_dart_gallery_basic.json
```

## Data Contracts

Inputs:
- `compiled/tactical_engine_rules_v1.json`
- `compiled/tactical_effect_models_v1.json`

Runtime contracts:
- `Scenario`: map + units + initial effects + scripted commands
- `Command`: actionable intent (`move`, `strike`, `use_triggered_action`, `end_turn`)
- `Event`: immutable, append-only log entry with timestamp, actor, payload

Output:
- `BattleResult` with final state, event log, replay hash, validation summary

## Test Gates

Gate 1: Structural integrity
- All scenario files schema-validated.
- Rule loaders reject malformed references.

Gate 2: Rules correctness
- Check/save degree-of-success test matrix passes.
- Damage + resistance/weakness + condition application tests pass.

Gate 3: Determinism
- Re-running same scenario with same seed and command stream yields identical event log hash.
- Minimum: 100 repeated runs with zero hash divergence.

Gate 4: Regression scenarios
- Smoke scenarios pass expected assertions (HP totals, conditions, turn counts, win/lose state).

Gate 5: Performance baseline
- Smoke suite runs under defined budget (for example: <2s local dev for baseline set).

Gate 6: Coverage threshold
- At least 85% line coverage for `engine/core`, `engine/rules`, `engine/effects`.

## Milestones

M1: Engine skeleton + scenario loader + deterministic RNG
- Exit criteria: minimal encounter executes with no rules effects.

M2: Check/save + damage/conditions + turn loop
- Exit criteria: core combat contract tests green.

M3: Targeting/areas + effect lifecycle hooks
- Exit criteria: fireball-style and hazard-style scenarios deterministic.

M4: Replay hash + regression harness
- Exit criteria: determinism gate and scenario regression gate green.

## Decision Checkpoints

Checkpoint A (after M1):
- Confirm runtime model (immutable reducer vs mutable simulation object).

Checkpoint B (after M2):
- Confirm effect representation (generic DSL vs typed handlers first).

Checkpoint C (after M3):
- Confirm performance and whether to optimize now or defer to Phase 4.

## Immediate Next Actions

1. Create the `engine/` package skeleton and test scaffolding.
2. Define JSON schema files for `Scenario`, `Command`, and `Event`.
3. Implement `rng.py`, `reducer.py`, and `turn_order.py` with determinism tests first.
4. Wire first smoke scenario from existing hazard models (`hidden_pit_basic.json`).
