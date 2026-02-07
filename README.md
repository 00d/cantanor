# cantanor
TRPG with ORC ruleset

See `PATHFINDER2_ORC_REFERENCE.md` for repository-wide source/reference mapping.
See `BROWSER_TACTICAL_TRPG_ANALYSIS.md` for browser tactics implementation analysis.
See `ROADMAP_VERIFICATION.md` for verified current status and remaining work.

Build Phase 1 tactical primitives: `python3 scripts/build_tactical_core_primitives.py`
Build Phase 2 engine rules: `python3 scripts/build_tactical_engine_rules.py`
Verify Phase 2 consistency: `python3 scripts/verify_phase2_consistency.py`
Build Phase 2.5 effect models: `python3 scripts/build_tactical_effect_models.py`
Verify Phase 2.5 consistency: `python3 scripts/verify_phase25_consistency.py`
Phase 3 execution plan: `PHASE3_IMPLEMENTATION_PLAN.md`
Run Phase 3 smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/hidden_pit_basic.json --out compiled/hidden_pit_basic_result.json`
Run Phase 3 M2 smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/m2_save_effect_basic.json --out compiled/m2_save_effect_basic_result.json`
Run Phase 3 M3 smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/m3_trigger_hazard_source_basic.json --out compiled/m3_trigger_hazard_source_basic_result.json`
Run Phase 3.5 affliction smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/m35_affliction_tick_basic.json --out compiled/m35_affliction_tick_basic_result.json`
Run Phase 3.5 regression matrix: `python3 -m unittest tests/scenarios/test_phase35_regression_matrix.py -v`
Run Phase 4 objective smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_objective_flag_basic.json --out compiled/phase4_objective_flag_basic_result.json`
Run Phase 4 auto-routine smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_hazard_routine_auto_basic.json --out compiled/phase4_hazard_routine_auto_basic_result.json`
Run Phase 4 cadence-limited auto-routine smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_hazard_routine_cadence_basic.json --out compiled/phase4_hazard_routine_cadence_basic_result.json`
Run Phase 4 zero-script auto-routine smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_hazard_routine_no_script_basic.json --out compiled/phase4_hazard_routine_no_script_basic_result.json`
Run Phase 4 mission-event spawn smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_mission_event_spawn_basic.json --out compiled/phase4_mission_event_spawn_basic_result.json`
Run Phase 4 flag-trigger mission smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_mission_trigger_flag_set_basic.json --out compiled/phase4_mission_trigger_flag_set_basic_result.json`
Run Phase 4 unit-death trigger smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_mission_trigger_unit_dead_basic.json --out compiled/phase4_mission_trigger_unit_dead_basic_result.json`
Run Phase 4 branching + wave-pack smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase4_mission_branching_waves_basic.json --out compiled/phase4_mission_branching_waves_basic_result.json`
Run Phase 4 regression matrix: `python3 -m unittest tests/scenarios/test_phase4_regression_matrix.py -v`
Run Phase 5 mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_damage_mitigation_basic.json --out compiled/phase5_damage_mitigation_basic_result.json`
Run Phase 5 grouped-mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_grouped_mitigation_basic.json --out compiled/phase5_grouped_mitigation_basic_result.json`
Run Phase 5 temp-HP mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_basic.json --out compiled/phase5_temp_hp_basic_result.json`
Run Phase 5 temp-HP effect smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_effect_basic.json --out compiled/phase5_temp_hp_effect_basic_result.json`
Run Phase 5 temp-HP expire smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_expire_basic.json --out compiled/phase5_temp_hp_expire_basic_result.json`
Run Phase 5 persistent recovery smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_persistent_recovery_basic.json --out compiled/phase5_persistent_recovery_basic_result.json`
Run Phase 5 condition immunity smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_condition_immunity_basic.json --out compiled/phase5_condition_immunity_basic_result.json`
Run Phase 3 tests: `python3 -m unittest discover -s tests -p 'test_*.py' -v`
