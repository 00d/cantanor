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
Phase 6 execution plan: `PHASE6_IMPLEMENTATION_PLAN.md`
Phase 7 execution plan: `PHASE7_IMPLEMENTATION_PLAN.md`
Phase 8 execution plan: `PHASE8_IMPLEMENTATION_PLAN.md`
Phase 9 execution plan: `PHASE9_IMPLEMENTATION_PLAN.md`
Phase 7 sample content pack: `corpus/content_packs/phase7_baseline_v1.json`
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
Run Phase 5 affliction-mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_affliction_mitigation_basic.json --out compiled/phase5_affliction_mitigation_basic_result.json`
Run Phase 5 mitigation-bypass smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_mitigation_bypass_basic.json --out compiled/phase5_mitigation_bypass_basic_result.json`
Run Phase 5 persistent-bypass smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_persistent_bypass_basic.json --out compiled/phase5_persistent_bypass_basic_result.json`
Run Phase 5 grouped-mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_grouped_mitigation_basic.json --out compiled/phase5_grouped_mitigation_basic_result.json`
Run Phase 5 mitigation-precedence smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_mitigation_precedence_basic.json --out compiled/phase5_mitigation_precedence_basic_result.json`
Run Phase 5 temp-HP mitigation smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_basic.json --out compiled/phase5_temp_hp_basic_result.json`
Run Phase 5 temp-HP effect smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_effect_basic.json --out compiled/phase5_temp_hp_effect_basic_result.json`
Run Phase 5 temp-HP expire smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_expire_basic.json --out compiled/phase5_temp_hp_expire_basic_result.json`
Run Phase 5 temp-HP source-policy smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_temp_hp_source_policy_basic.json --out compiled/phase5_temp_hp_source_policy_basic_result.json`
Run Phase 5 persistent recovery smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_persistent_recovery_basic.json --out compiled/phase5_persistent_recovery_basic_result.json`
Run Phase 5 condition immunity smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase5_condition_immunity_basic.json --out compiled/phase5_condition_immunity_basic_result.json`
Run Phase 5 regression matrix: `python3 -m unittest tests/scenarios/test_phase5_regression_matrix.py -v`
Run Phase 6 cast-spell smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase6_cast_spell_basic.json --out compiled/phase6_cast_spell_basic_result.json`
Run Phase 6 use-feat smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase6_use_feat_effect_basic.json --out compiled/phase6_use_feat_effect_basic_result.json`
Run Phase 6 use-item smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase6_use_item_effect_basic.json --out compiled/phase6_use_item_effect_basic_result.json`
Run Phase 6 forecast strike smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase6_forecast_strike_basic.json --out compiled/phase6_forecast_strike_basic_result.json`
Run Phase 6 enemy-policy smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase6_enemy_policy_duel_basic.json --out compiled/phase6_enemy_policy_duel_basic_result.json`
Run Phase 6 command-variant scenario tests: `python3 -m unittest tests/scenarios/test_phase6_command_variants.py -v`
Run Phase 6 forecast scenario tests: `python3 -m unittest tests/scenarios/test_phase6_forecast_strike.py -v`
Run Phase 6 enemy-policy scenario tests: `python3 -m unittest tests/scenarios/test_phase6_enemy_policy.py -v`
Run Phase 6 regression matrix: `python3 -m unittest tests/scenarios/test_phase6_regression_matrix.py -v`
Run Phase 7 content-pack loader contract tests: `python3 -m unittest tests/contract/test_content_pack_loader.py -v`
Run Phase 7 interact smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase7_interact_basic.json --out compiled/phase7_interact_basic_result.json`
Run Phase 7 interact scenario tests: `python3 -m unittest tests/scenarios/test_phase7_interact_command.py -v`
Run Phase 7 content-pack integration smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase7_content_pack_integration_basic.json --out compiled/phase7_content_pack_integration_basic_result.json`
Run Phase 7 content-pack integration scenario tests: `python3 -m unittest tests/scenarios/test_phase7_content_pack_integration.py -v`
Run Phase 7 regression matrix: `python3 -m unittest tests/scenarios/test_phase7_regression_matrix.py -v`
Run Phase 8 pack-template cast-spell smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase8_pack_cast_spell_basic.json --out compiled/phase8_pack_cast_spell_basic_result.json`
Run Phase 8 pack-template use-feat smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase8_pack_use_feat_basic.json --out compiled/phase8_pack_use_feat_basic_result.json`
Run Phase 8 pack-template enemy-policy spell smoke scenario: `python3 -m engine.cli.run_scenario scenarios/smoke/phase8_enemy_policy_pack_spell_basic.json --out compiled/phase8_enemy_policy_pack_spell_basic_result.json`
Run Phase 8 content-entry template tests: `python3 -m unittest tests/scenarios/test_phase8_content_entry_templates.py -v`
Run Phase 8 enemy-policy template tests: `python3 -m unittest tests/scenarios/test_phase8_enemy_policy_templates.py -v`
Run Phase 8 regression matrix: `python3 -m unittest tests/scenarios/test_phase8_regression_matrix.py -v`
Run Phase 9 command-authoring contract tests: `python3 -m unittest tests/contract/test_command_authoring.py -v`
Run Phase 3 tests: `python3 -m unittest discover -s tests -p 'test_*.py' -v`
