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


if __name__ == "__main__":
    unittest.main()
