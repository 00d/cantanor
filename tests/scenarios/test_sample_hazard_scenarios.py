from __future__ import annotations

import json
import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


SCENARIOS = [
    Path("scenarios/smoke/hidden_pit_basic.json"),
    Path("scenarios/smoke/fireball_rune_basic.json"),
    Path("scenarios/smoke/poisoned_dart_gallery_basic.json"),
    Path("scenarios/smoke/m2_save_effect_basic.json"),
    Path("scenarios/smoke/m3_trigger_hazard_source_basic.json"),
    Path("scenarios/smoke/m35_affliction_tick_basic.json"),
    Path("scenarios/smoke/phase4_objective_flag_basic.json"),
    Path("scenarios/smoke/phase4_hazard_routine_auto_basic.json"),
    Path("scenarios/smoke/phase4_hazard_routine_cadence_basic.json"),
    Path("scenarios/smoke/phase4_hazard_routine_no_script_basic.json"),
    Path("scenarios/smoke/phase4_mission_event_spawn_basic.json"),
    Path("scenarios/smoke/phase4_mission_trigger_flag_set_basic.json"),
    Path("scenarios/smoke/phase4_mission_trigger_unit_dead_basic.json"),
    Path("scenarios/smoke/phase4_mission_branching_waves_basic.json"),
    Path("scenarios/smoke/phase5_damage_mitigation_basic.json"),
    Path("scenarios/smoke/phase5_affliction_mitigation_basic.json"),
    Path("scenarios/smoke/phase5_mitigation_bypass_basic.json"),
    Path("scenarios/smoke/phase5_grouped_mitigation_basic.json"),
    Path("scenarios/smoke/phase5_mitigation_precedence_basic.json"),
    Path("scenarios/smoke/phase5_temp_hp_basic.json"),
    Path("scenarios/smoke/phase5_temp_hp_effect_basic.json"),
    Path("scenarios/smoke/phase5_temp_hp_expire_basic.json"),
    Path("scenarios/smoke/phase5_temp_hp_source_policy_basic.json"),
    Path("scenarios/smoke/phase5_persistent_bypass_basic.json"),
    Path("scenarios/smoke/phase5_persistent_recovery_basic.json"),
    Path("scenarios/smoke/phase5_condition_immunity_basic.json"),
    Path("scenarios/smoke/phase6_cast_spell_basic.json"),
    Path("scenarios/smoke/phase6_use_feat_effect_basic.json"),
    Path("scenarios/smoke/phase6_use_item_effect_basic.json"),
    Path("scenarios/smoke/phase6_forecast_strike_basic.json"),
    Path("scenarios/smoke/phase6_enemy_policy_duel_basic.json"),
]


class TestSampleHazardScenarios(unittest.TestCase):
    def test_smoke_scenarios_execute_without_command_errors(self) -> None:
        for scenario in SCENARIOS:
            with self.subTest(scenario=scenario.name):
                result = run_scenario_file(scenario)
                event_types = [e["type"] for e in result["events"]]
                self.assertNotIn("command_error", event_types)
                self.assertEqual(len(result["replay_hash"]), 64)
                command_count = len(json.loads(scenario.read_text(encoding="utf-8"))["commands"])
                self.assertLessEqual(result["executed_commands"], command_count)


if __name__ == "__main__":
    unittest.main()
