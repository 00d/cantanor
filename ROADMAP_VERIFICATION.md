# Roadmap Verification

Verified on February 6, 2026.

## Current Status (Implemented)

- Phase 1 complete: `compiled/tactical_core_primitives.json` generated from extracted corpus.
- Phase 2 complete: `compiled/tactical_engine_rules_v1.json` generated and validated.
- Phase 2.5 complete: `compiled/tactical_effect_models_v1.json` generated and validated.
- Phase 3 in progress:
  - M1 complete: deterministic engine scaffold, command reducer, scenario runner.
  - M2 complete: save/damage command + effect lifecycle hooks.
  - M3 complete: area-save command and model-driven hazard source command are implemented and covered by tests.
- Phase 3.5 complete:
  - Cone/burst/emanation selection in model-driven hazard targeting.
  - Affliction stage runtime with lifecycle ticks and deterministic progression.
  - Obstacle-aware AoE clipping using tile line-of-effect checks.
  - Corner pinch blocking and strike cover bonuses (`standard`/`greater`) in LOS/LOE flow.
  - Affliction edge handling: stage-duration pacing, persistence exceptions, and condition recovery transitions.
  - Deterministic regression matrix with 10 hazard-derived scenarios and locked replay hashes.
- Phase 4 complete:
  - Objective evaluation runtime (`victory`/`defeat` objective sets) with objective-driven battle end.
  - Scenario flags + script command (`set_flag`) for mission state transitions.
  - Hazard routine command (`run_hazard_routine`) with target policies for automated hazard actions.
  - Auto hazard routine scheduling in scenario runner via `hazard_routines` (no explicit scripted routine command required).
  - Scenario runner supports routine execution even when scripted command list is empty (`commands: []`).
  - Objective pack expansion (`eliminate_team`, `escape_unit`, `holdout`) into runtime objective sets.
  - Spawn scripting via `spawn_unit` command, including deterministic `nearest_open` placement policy.
  - Mission event triggers (`turn_start` / `round_start`) that can execute scripted command blocks with objective-aware battle end checks.
  - Conditional mission-event branching (`if_flag` with `then_commands` / `else_commands`) for encounter state-driven scripting.
  - Reinforcement-wave packs (`reinforcement_waves`) compiled into mission-event command blocks for scheduled multi-wave spawns.
  - Advanced mission-event triggers (`unit_dead`, `unit_alive`, `flag_set`) for state-reactive encounter scripting.
  - Hazard routine cadence controls (`cadence_rounds`, `max_triggers`, `priority`) for complex hazard turn behavior.
  - Strict command-variant scenario validation for loader contracts (required per-command fields + supported command types).
  - Deterministic Phase 4 regression matrix with locked replay hashes.

## Verification Evidence

- Data consistency:
  - `python3 scripts/verify_phase2_consistency.py` -> `compiled/phase2_verification_report.json` (`passed=true`)
  - `python3 scripts/verify_phase25_consistency.py` -> `compiled/phase25_verification_report.json` (`passed=true`)
- Engine quality:
  - `python3 -m py_compile $(find engine tests -name '*.py' | tr '\n' ' ')` (clean)
  - `python3 -m unittest discover -s tests -p 'test_*.py' -v` (all tests passing)
- Scenario evidence:
  - `scenarios/smoke/m3_trigger_hazard_source_basic.json` exercises `trigger_hazard_source` against phase 2.5 data.
  - `scenarios/smoke/m35_affliction_tick_basic.json` exercises modeled affliction apply + tick lifecycle flow.
  - `tests/scenarios/test_phase35_regression_matrix.py` validates 10 phase 3.5 hazard regressions against `scenarios/regression_phase35/expected_hashes.json`.
  - `scenarios/smoke/phase4_objective_flag_basic.json` exercises objective completion via scripted flag transitions.
  - `scenarios/smoke/phase4_hazard_routine_auto_basic.json` exercises auto hazard routine execution via `hazard_routines`.
  - `scenarios/smoke/phase4_hazard_routine_cadence_basic.json` exercises cadence-limited + max-trigger hazard routine scheduling.
  - `scenarios/smoke/phase4_hazard_routine_no_script_basic.json` exercises autonomous hazard routine execution with no scripted commands.
  - `scenarios/smoke/phase4_mission_event_spawn_basic.json` exercises round-start mission event triggers with reinforcement spawn + flag transition.
  - `scenarios/smoke/phase4_mission_trigger_flag_set_basic.json` exercises `flag_set` mission trigger flow with reactionary spawning.
  - `scenarios/smoke/phase4_mission_trigger_unit_dead_basic.json` exercises `unit_dead` mission trigger flow for state-reactive objectives.
  - `scenarios/smoke/phase4_mission_branching_waves_basic.json` exercises branch-driven wave selection and wave-pack scheduling in the same round-start window.
  - `tests/scenarios/test_phase4_regression_matrix.py` validates 8 phase 4 encounter regressions against `scenarios/regression_phase4/expected_hashes.json`.

## AoN Cross-Check (Spot Verification)

The hazard mappings used by smoke scenarios and model execution were spot-checked against Archives of Nethys:

- Hidden Pit (legacy): https://2e.aonprd.com/Hazards.aspx?ID=1
- Fireball Rune (legacy): https://2e.aonprd.com/Hazards.aspx?ID=7
- Poisoned Dart Gallery (legacy): https://2e.aonprd.com/Hazards.aspx?ID=123

Cross-check focus:
- Trigger semantics (for example, trigger action names like `Pitfall`, `Fireball`, `Dart Volley`)
- Save metadata where present (for example `DC 22 basic Reflex` on Fireball Rune)
- Damage/affliction intent used in effect-model conversion

## What Is Still Needed for a Massive Browser TRPG

1. Rules completeness
- Expand from hazard-centric smoke coverage to full action/spell/feat/item pipelines.
- Add parser normalization for class progression, feat prerequisites, spell targeting, and trait interactions.

2. Tactical correctness depth
- Implement resistances/weaknesses/immunities, persistent damage recovery checks, and full affliction stage progression.
- Add real area shapes (cone/burst/emanation geometry) and stricter line-of-effect rules.

3. Content/runtime integration
- Build a versioned content pack compiler (book-scoped bundles + compatibility tags).
- Extend JSON schema to enforce per-command required fields via discriminated command variants (currently enforced in loader runtime validation).

4. Encounter systems
- Expand from deterministic scripted encounter logic to richer enemy decision policies and hazard subsystem state machines.

5. Frontend game layer
- Tile renderer, animation timing model, input/UI overlays, forecast panels, and build-management UI.
- Deterministic net/replay protocol design if multiplayer or asynchronous replays are required.

6. Production engineering
- Coverage and regression expansion beyond smoke tests.
- Performance profiling under large maps/unit counts and browser memory budgets.
- Compliance/provenance workflow separating mechanics from legal/trademark text in source extracts.

## Recommended Next Milestone

Phase 5 should focus on gameplay breadth beyond encounter scaffolding:
- class/feat/spell/item execution pipelines on top of the deterministic core,
- resistance/weakness/immunity and persistent recovery depth,
- browser gameplay loop integration (rendering, forecasting, and UX command layers).
