# Roadmap Verification

Verified on February 7, 2026.

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
- Phase 5 complete:
  - Damage mitigation baseline for resistances, weaknesses, and immunities in `strike`, `save_damage`, `area_save_damage`, and modeled hazard damage resolution.
  - Overlapping resistance/weakness precedence now resolves to the highest applicable value (exact, grouped tag, or `all`) instead of stacking totals.
  - Affliction stage damage now routes through the same mitigation layer (resistance/weakness/immunity + temp-HP-first consumption) as other damage sources.
  - Typed mitigation exceptions via `bypass`/`damage_bypass`/`attack_damage_bypass` now allow packets to ignore matching resistances/immunities across strike/save/area/modeled/persistent/affliction damage paths.
  - Grouped mitigation tags for umbrella damage categories (`physical`, `energy`) alongside specific damage types.
  - Temporary HP runtime consumption layer (damage applies to temp HP before HP across strike/save/area/modeled/persistent/affliction damage flows).
  - Source-aware temporary HP grant effect baseline (`apply_effect` with `effect_kind=temp_hp`) with same-source refresh, cross-source precedence (`higher_only`/`replace`/`ignore`), configurable stack mode (`max`/`add`), and expiration cleanup (`remove_on_expire`).
  - Unit-level mitigation metadata in scenario/runtime contracts (`attack_damage_type`, `resistances`, `weaknesses`, `immunities`).
  - Persistent damage recovery checks (flat-check style) with immediate effect expiration on successful recovery.
  - Condition immunity support in direct condition effects, affliction stage application, and modeled hazard condition events.
  - Spawn runtime now preserves unit-level condition immunity metadata (`condition_immunities`).
  - Deterministic Phase 5 regression matrix with 12 mitigation/lifecycle scenarios and locked replay hashes.
- Phase 6 complete:
  - Baseline gameplay command variants: `cast_spell`, `use_feat`, and `use_item`.
  - Action-cost aware command execution for Phase 6 variants (`action_cost` with deterministic budget checks).
  - Reducer-backed effect adapter flow for feat/item usage through lifecycle hooks (`effect_apply`/tick/expire paths).
  - Initial Phase 6 smoke scenarios and scenario-level tests for command variants.
  - Forecast payload baseline for `strike`/`cast_spell` command previews (degree odds + expected raw damage outputs).
  - Scenario-level deterministic enemy policy baseline (`strike_nearest` + optional auto end-turn) for non-scripted encounter turns.
  - Deterministic Phase 6 regression matrix with 5 gameplay-breadth scenarios and locked replay hashes.
- Phase 7 complete:
  - M7.1 content-pack contract baseline scaffolded (`engine/io/content_pack_loader.py`, `engine/io/schemas/content_pack.schema.json`).
  - Baseline versioned sample pack added at `corpus/content_packs/phase7_baseline_v1.json`.
  - Contract coverage added for pack validation and phase compatibility checks.
  - M7.2 interact command baseline added (`interact` command variant with deterministic action-cost, optional flag updates, and effect lifecycle wiring).
  - M7.3 pack-aware scenario integration added (scenario-level `content_packs` resolution, phase compatibility checks, optional feature-tag requirements, and browser-facing `content_pack_context`/`content_pack_resolved` payloads).
  - M7.4 deterministic Phase 7 regression matrix added with locked replay hashes.
- Phase 8 started:
  - M8.1 content-entry command template baseline added (`content_entry_id` materialization into `cast_spell` / `use_feat` / `use_item` / `interact` runtime command payloads).
  - Scenario-level `engine_phase` contract added so compatibility checks can evolve per scenario without breaking older hashes.
  - Deterministic mismatch handling added for content-entry command-type conflicts (runtime `command_error` path).

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
  - `scenarios/smoke/phase5_damage_mitigation_basic.json` exercises mitigation-aware save damage with resistance/weakness interaction.
  - `scenarios/smoke/phase5_affliction_mitigation_basic.json` exercises mitigation-aware affliction stage damage.
  - `scenarios/smoke/phase5_mitigation_bypass_basic.json` exercises mitigation bypass against matching resistance and immunity keys.
  - `scenarios/smoke/phase5_persistent_bypass_basic.json` exercises persistent-damage bypass against matching immunity.
  - `scenarios/smoke/phase5_grouped_mitigation_basic.json` exercises grouped-type mitigation (`fire -> energy`, `slashing -> physical`).
  - `scenarios/smoke/phase5_mitigation_precedence_basic.json` exercises overlap precedence (highest-only) across exact/grouped/`all` keys.
  - `scenarios/smoke/phase5_temp_hp_basic.json` exercises temp-HP-first damage consumption for strike damage.
  - `scenarios/smoke/phase5_temp_hp_effect_basic.json` exercises temp-HP grant via effect lifecycle and later strike absorption.
  - `scenarios/smoke/phase5_temp_hp_expire_basic.json` exercises temp-HP effect expiration and cleanup of remaining pool.
  - `scenarios/smoke/phase5_temp_hp_source_policy_basic.json` exercises cross-source temp-HP precedence (`ignore` then `replace`).
  - `tests/contract/test_effect_lifecycle.py` includes source-aware temp-HP behavior checks (same-source refresh and cross-source higher-only precedence).
  - `tests/contract/test_damage_mitigation_runtime.py` validates modeled/strike/save command mitigation behavior.
  - `tests/contract/test_affliction_edge_cases.py` includes affliction-stage damage mitigation coverage.
  - `scenarios/smoke/phase5_persistent_recovery_basic.json` exercises persistent damage recovery and expiration flow.
  - `tests/contract/test_effect_lifecycle.py` includes persistent recovery success/failure coverage.
  - `scenarios/smoke/phase5_condition_immunity_basic.json` exercises condition immunity handling for condition effects.
  - `tests/contract/test_affliction_edge_cases.py` and `tests/contract/test_hazard_model_commands.py` include condition immunity coverage for afflictions and modeled hazard conditions.
  - `tests/scenarios/test_phase5_regression_matrix.py` validates 12 phase 5 mitigation/lifecycle regressions against `scenarios/regression_phase5/expected_hashes.json`.
  - `scenarios/smoke/phase6_cast_spell_basic.json` exercises spell command save/damage resolution with action-cost handling.
  - `scenarios/smoke/phase6_use_feat_effect_basic.json` and `scenarios/smoke/phase6_use_item_effect_basic.json` exercise feat/item effect adapter flows into lifecycle hooks.
  - `tests/scenarios/test_phase6_command_variants.py` validates baseline Phase 6 command behavior and deterministic execution.
  - `tests/contract/test_forecast_payloads.py` validates forecast payload math/shape for strike and cast-spell previews.
  - `scenarios/smoke/phase6_forecast_strike_basic.json` + `tests/scenarios/test_phase6_forecast_strike.py` exercise forecast payload emission on strike events.
  - `scenarios/smoke/phase6_enemy_policy_duel_basic.json` + `tests/scenarios/test_phase6_enemy_policy.py` exercise deterministic non-scripted turns via enemy policy.
  - `tests/scenarios/test_phase6_regression_matrix.py` validates 5 phase 6 gameplay-breadth regressions against `scenarios/regression_phase6/expected_hashes.json`.
  - `tests/contract/test_content_pack_loader.py` validates phase 7 content-pack contracts (semver, compatibility bounds, duplicate entry rejection, loader integration).
  - `scenarios/smoke/phase7_interact_basic.json` + `tests/scenarios/test_phase7_interact_command.py` validate phase 7 `interact` command behavior and lifecycle integration.
  - `scenarios/smoke/phase7_content_pack_integration_basic.json` + `tests/scenarios/test_phase7_content_pack_integration.py` validate scenario-level content pack resolution and integration payload contracts.
  - `tests/scenarios/test_phase7_regression_matrix.py` validates 5 phase 7 regressions against `scenarios/regression_phase7/expected_hashes.json`.
  - `scenarios/smoke/phase8_pack_cast_spell_basic.json` and `scenarios/smoke/phase8_pack_use_feat_basic.json` validate phase 8 pack-template command execution for spell/feat flows.
  - `tests/scenarios/test_phase8_content_entry_templates.py` validates template materialization and mismatch error handling.

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
- Expand mitigation to cover additional rules interactions (for example non-damage effects, conditional bypass exceptions, and source trait layering).
- Deepen tactical geometry and visibility fidelity beyond current baseline LOE/LOS behavior for high-density maps.

3. Content/runtime integration
- Build a versioned content pack compiler pipeline on top of the new pack contract baseline (book-scoped bundles + compatibility tags).
- Extend JSON schema to enforce per-command required fields via discriminated command variants (currently enforced in loader runtime validation).

4. Encounter systems
- Expand from baseline deterministic enemy policy (`strike_nearest`) to richer tactical policies and hazard subsystem state machines.

5. Frontend game layer
- Tile renderer, animation timing model, input/UI overlays, forecast panels, and build-management UI.
- Deterministic net/replay protocol design if multiplayer or asynchronous replays are required.

6. Production engineering
- Coverage and regression expansion beyond smoke tests.
- Performance profiling under large maps/unit counts and browser memory budgets.
- Compliance/provenance workflow separating mechanics from legal/trademark text in source extracts.

## Recommended Next Milestone

Continue Phase 8 with M8.2 and M8.3:
- pack-driven enemy policy action selection (beyond `strike_nearest`),
- phase 8 regression matrix + expected hash lock for template-driven scenarios,
- browser-facing event trace expansion for template source/policy rationale.
