from __future__ import annotations

import unittest

from engine.io.scenario_loader import ScenarioValidationError, validate_scenario


def _base_scenario() -> dict:
    return {
        "battle_id": "scenario_validation_contracts",
        "seed": 123,
        "map": {"width": 6, "height": 6, "blocked": []},
        "units": [
            {
                "id": "hazard_core",
                "team": "hazard",
                "hp": 30,
                "position": [2, 2],
                "initiative": 20,
                "attack_mod": 0,
                "ac": 10,
                "damage": "1d1",
            },
            {
                "id": "pc",
                "team": "pc",
                "hp": 30,
                "position": [3, 2],
                "initiative": 10,
                "attack_mod": 7,
                "ac": 17,
                "damage": "1d8+3",
            },
        ],
        "commands": [],
    }


class TestScenarioValidation(unittest.TestCase):
    def test_spawned_actor_can_be_referenced_later(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "spawn_unit",
                "actor": "hazard_core",
                "unit": {
                    "id": "hazard_add",
                    "team": "hazard",
                    "hp": 12,
                    "position": [1, 1],
                    "initiative": 8,
                    "attack_mod": 4,
                    "ac": 14,
                    "damage": "1d6+1",
                },
            },
            {"type": "end_turn", "actor": "hazard_add"},
        ]
        validate_scenario(scenario)

    def test_rejects_missing_variant_fields(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [{"type": "area_save_damage", "actor": "hazard_core", "center_x": 2, "center_y": 2}]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_unknown_command_type(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [{"type": "teleport_party", "actor": "hazard_core"}]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_unit_dead_trigger_with_unknown_unit(self) -> None:
        scenario = _base_scenario()
        scenario["mission_events"] = [
            {
                "id": "bad_dead_trigger",
                "trigger": "unit_dead",
                "unit_id": "missing_unit",
                "commands": [{"type": "set_flag", "flag": "x", "value": True}],
            }
        ]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_flag_trigger_without_flag_name(self) -> None:
        scenario = _base_scenario()
        scenario["mission_events"] = [
            {
                "id": "bad_flag_trigger",
                "trigger": "flag_set",
                "commands": [{"type": "set_flag", "flag": "x", "value": True}],
            }
        ]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_invalid_damage_bypass_shape(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "save_damage",
                "actor": "hazard_core",
                "target": "pc",
                "dc": 20,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "damage_bypass": "fire",
                "mode": "basic",
            }
        ]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_accepts_phase6_command_variants(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "cast_spell",
                "actor": "hazard_core",
                "spell_id": "spark_bolt",
                "target": "pc",
                "dc": 19,
                "save_type": "Reflex",
                "damage": "2d6",
                "mode": "basic",
            },
            {
                "type": "use_feat",
                "actor": "hazard_core",
                "feat_id": "adrenaline_rush",
                "target": "hazard_core",
                "effect_kind": "temp_hp",
                "payload": {"amount": 4},
            },
            {
                "type": "use_item",
                "actor": "hazard_core",
                "item_id": "bottled_focus",
                "target": "hazard_core",
                "effect_kind": "condition",
                "payload": {"name": "frightened", "value": 1},
                "duration_rounds": 1,
                "tick_timing": "turn_end",
            },
        ]
        validate_scenario(scenario)

    def test_rejects_use_item_non_positive_action_cost(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "use_item",
                "actor": "hazard_core",
                "item_id": "healing_potion",
                "target": "hazard_core",
                "effect_kind": "temp_hp",
                "payload": {"amount": 3},
                "action_cost": 0,
            }
        ]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_accepts_enemy_policy_shape(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {
            "enabled": True,
            "teams": ["hazard", "pc"],
            "action": "strike_nearest",
            "auto_end_turn": True,
        }
        validate_scenario(scenario)

    def test_rejects_enemy_policy_unknown_action(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {"enabled": True, "action": "cast_random_spell"}
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_accepts_enemy_policy_template_action_shape(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {
            "enabled": True,
            "teams": ["hazard"],
            "action": "cast_spell_entry_nearest",
            "content_entry_id": "spell.arc_flash",
            "dc": 21,
            "include_rationale": True,
            "auto_end_turn": True,
        }
        validate_scenario(scenario)

    def test_rejects_enemy_policy_template_missing_content_entry(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {"enabled": True, "action": "use_feat_entry_self"}
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_enemy_policy_cast_spell_template_missing_dc(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {
            "enabled": True,
            "action": "cast_spell_entry_nearest",
            "content_entry_id": "spell.arc_flash",
        }
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_enemy_policy_include_rationale_non_bool(self) -> None:
        scenario = _base_scenario()
        scenario["enemy_policy"] = {"enabled": True, "action": "strike_nearest", "include_rationale": "yes"}
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_accepts_interact_command_variant(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "interact",
                "actor": "hazard_core",
                "interact_id": "open_panel",
                "target": "hazard_core",
                "effect_kind": "temp_hp",
                "payload": {"amount": 2},
                "flag": "panel_open",
                "value": True,
            }
        ]
        validate_scenario(scenario)

    def test_rejects_interact_without_interact_id(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "interact",
                "actor": "hazard_core",
                "target": "hazard_core",
            }
        ]
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_accepts_content_pack_scenario_fields(self) -> None:
        scenario = _base_scenario()
        scenario["content_packs"] = ["corpus/content_packs/phase7_baseline_v1.json"]
        scenario["content_pack_id"] = "phase7-baseline-v1"
        scenario["required_content_features"] = ["content_pack_loader"]
        validate_scenario(scenario)

    def test_accepts_content_entry_cast_spell_compact_shape(self) -> None:
        scenario = _base_scenario()
        scenario["commands"] = [
            {
                "type": "cast_spell",
                "actor": "hazard_core",
                "content_entry_id": "spell.arc_flash",
                "target": "pc",
                "dc": 20,
            }
        ]
        validate_scenario(scenario)

    def test_rejects_content_pack_id_without_packs(self) -> None:
        scenario = _base_scenario()
        scenario["content_pack_id"] = "phase7-baseline-v1"
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)

    def test_rejects_non_positive_engine_phase(self) -> None:
        scenario = _base_scenario()
        scenario["engine_phase"] = 0
        with self.assertRaises(ScenarioValidationError):
            validate_scenario(scenario)


if __name__ == "__main__":
    unittest.main()
