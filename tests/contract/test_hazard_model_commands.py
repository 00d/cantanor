from __future__ import annotations

import json
import os
import tempfile
import unittest

from engine.core.reducer import ReductionError, apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


def _base_scenario() -> dict:
    return {
        "battle_id": "hazard_model_commands",
        "seed": 777,
        "map": {"width": 8, "height": 8, "blocked": []},
        "units": [
            {
                "id": "hazard_core",
                "team": "hazard",
                "hp": 999,
                "position": [3, 3],
                "initiative": 20,
                "attack_mod": 0,
                "ac": 10,
                "damage": "1d1",
                "fortitude": 0,
                "reflex": 0,
                "will": 0,
            },
            {
                "id": "pc_1",
                "team": "pc",
                "hp": 30,
                "position": [3, 4],
                "initiative": 12,
                "attack_mod": 7,
                "ac": 17,
                "damage": "1d8+3",
                "fortitude": 7,
                "reflex": 4,
                "will": 3,
            },
            {
                "id": "pc_2",
                "team": "pc",
                "hp": 30,
                "position": [4, 4],
                "initiative": 10,
                "attack_mod": 6,
                "ac": 16,
                "damage": "1d8+3",
                "fortitude": 6,
                "reflex": 8,
                "will": 5,
            },
        ],
        "commands": [],
    }


class TestHazardModelCommands(unittest.TestCase):
    def test_trigger_hazard_source_fireball_uses_modeled_save_damage(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "trigger_hazard_source",
                "actor": "hazard_core",
                "hazard_id": "fireball-rune",
                "source_name": "Fireball",
                "source_type": "trigger_action",
                "center_x": 3,
                "center_y": 4,
            },
            rng,
        )

        self.assertEqual(events[0]["type"], "trigger_hazard_source")
        payload = events[0]["payload"]
        self.assertEqual(payload["target_ids"], ["pc_1", "pc_2"])
        self.assertIn("save_check", payload["effect_kinds"])
        self.assertIn("damage", payload["effect_kinds"])
        self.assertEqual(state.units["hazard_core"].actions_remaining, 2)

        # Deterministic regression values for the current reducer + seed path.
        self.assertEqual(state.units["pc_1"].hp, 0)
        self.assertEqual(state.units["pc_2"].hp, 18)
        self.assertEqual(payload["results"][0]["save"]["degree"], "critical_failure")
        self.assertEqual(payload["results"][1]["save"]["degree"], "success")

    def test_area_save_damage_excludes_actor_by_default(self) -> None:
        scenario = _base_scenario()
        scenario["seed"] = 321
        scenario["units"][0]["id"] = "caster"
        scenario["units"][0]["team"] = "pc"
        scenario["units"][0]["hp"] = 25
        scenario["units"][0]["position"] = [1, 1]
        scenario["units"][0]["initiative"] = 18
        scenario["units"][0]["fortitude"] = 5
        scenario["units"][0]["reflex"] = 6
        scenario["units"][0]["will"] = 7
        scenario["units"][1]["id"] = "enemy_1"
        scenario["units"][1]["team"] = "enemy"
        scenario["units"][1]["hp"] = 20
        scenario["units"][1]["position"] = [2, 1]
        scenario["units"][1]["reflex"] = 2
        scenario["units"][2]["id"] = "enemy_2"
        scenario["units"][2]["team"] = "enemy"
        scenario["units"][2]["hp"] = 20
        scenario["units"][2]["position"] = [4, 4]
        scenario["units"][2]["reflex"] = 3

        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "area_save_damage",
                "actor": "caster",
                "center_x": 1,
                "center_y": 1,
                "radius_feet": 10,
                "dc": 18,
                "save_type": "Reflex",
                "damage": "2d6",
                "mode": "basic",
            },
            rng,
        )

        payload = events[0]["payload"]
        self.assertEqual(events[0]["type"], "area_save_damage")
        self.assertEqual(payload["targets"], ["enemy_1"])
        self.assertEqual(state.units["caster"].hp, 25)
        self.assertEqual(state.units["enemy_1"].hp, 14)
        self.assertEqual(state.units["enemy_2"].hp, 20)

    def test_trigger_hazard_source_missing_source_raises(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        with self.assertRaises(ReductionError):
            apply_command(
                state,
                {
                    "type": "trigger_hazard_source",
                    "actor": "hazard_core",
                    "hazard_id": "fireball-rune",
                    "source_name": "Nope",
                    "source_type": "trigger_action",
                },
                rng,
            )

    def test_trigger_hazard_source_cone_uses_facing_selection(self) -> None:
        scenario = {
            "battle_id": "cone_targeting",
            "seed": 456,
            "map": {"width": 12, "height": 12, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [5, 5],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                    "fortitude": 0,
                    "reflex": 0,
                    "will": 0,
                },
                {
                    "id": "pc_front",
                    "team": "pc",
                    "hp": 30,
                    "position": [7, 5],
                    "initiative": 12,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 5,
                    "reflex": 5,
                    "will": 12,
                },
                {
                    "id": "pc_diag",
                    "team": "pc",
                    "hp": 30,
                    "position": [7, 6],
                    "initiative": 11,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 5,
                    "reflex": 5,
                    "will": 12,
                },
                {
                    "id": "pc_side",
                    "team": "pc",
                    "hp": 30,
                    "position": [5, 7],
                    "initiative": 10,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 5,
                    "reflex": 5,
                    "will": 12,
                },
                {
                    "id": "pc_back",
                    "team": "pc",
                    "hp": 30,
                    "position": [3, 5],
                    "initiative": 9,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 5,
                    "reflex": 5,
                    "will": 12,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "trigger_hazard_source",
                "actor": "hazard_core",
                "hazard_id": "hallucination-powder-trap",
                "source_name": "Powder Burst",
                "source_type": "trigger_action",
                "center_x": 8,
                "center_y": 5,
            },
            rng,
        )

        target_ids = events[0]["payload"]["target_ids"]
        self.assertIn("pc_front", target_ids)
        self.assertIn("pc_diag", target_ids)
        self.assertNotIn("pc_side", target_ids)
        self.assertNotIn("pc_back", target_ids)

    def test_trigger_hazard_source_affliction_creates_and_ticks_effect(self) -> None:
        scenario = {
            "battle_id": "affliction_runtime",
            "seed": 888,
            "map": {"width": 8, "height": 8, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [3, 3],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                    "fortitude": 0,
                    "reflex": 0,
                    "will": 0,
                },
                {
                    "id": "pc_1",
                    "team": "pc",
                    "hp": 40,
                    "position": [3, 4],
                    "initiative": 10,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": -5,
                    "reflex": 4,
                    "will": 3,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        hp_before = state.units["pc_1"].hp
        state, events = apply_command(
            state,
            {
                "type": "trigger_hazard_source",
                "actor": "hazard_core",
                "hazard_id": "poisoned-dart-gallery",
                "source_name": "Continuous Barrage",
                "source_type": "trigger_action",
                "target": "pc_1",
            },
            rng,
        )
        trigger_payload = events[0]["payload"]
        result = trigger_payload["results"][0]
        self.assertTrue(result["affliction"]["contracted"])
        effect_id = result["affliction"]["effect_id"]
        self.assertIsNotNone(effect_id)
        self.assertIn(effect_id, state.effects)
        self.assertLess(state.units["pc_1"].hp, hp_before)
        self.assertGreaterEqual(state.units["pc_1"].conditions.get("clumsy", 0), 1)

        # Advance to target turn and tick affliction once.
        state, _ = apply_command(state, {"type": "end_turn", "actor": "hazard_core"}, rng)
        hp_after_apply = state.units["pc_1"].hp
        state, events = apply_command(state, {"type": "end_turn", "actor": "pc_1"}, rng)
        hp_after_tick = state.units["pc_1"].hp
        self.assertLessEqual(hp_after_tick, hp_after_apply)
        self.assertIn("effect_tick", [event["type"] for event in events])

    def test_trigger_hazard_source_burst_targets_radius_from_center(self) -> None:
        scenario = {
            "battle_id": "burst_targeting",
            "seed": 999,
            "map": {"width": 8, "height": 8, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                    "fortitude": 0,
                    "reflex": 0,
                    "will": 0,
                },
                {
                    "id": "pc_near",
                    "team": "pc",
                    "hp": 20,
                    "position": [3, 2],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
                {
                    "id": "pc_far",
                    "team": "pc",
                    "hp": 20,
                    "position": [7, 7],
                    "initiative": 9,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
            ],
            "commands": [],
        }
        model = {
            "hazards": {
                "entries": [
                    {
                        "hazard_id": "burst-demo",
                        "hazard_name": "Burst Demo",
                        "sources": [
                            {
                                "source_type": "trigger_action",
                                "source_name": "Burst",
                                "effects": [
                                    {"kind": "area", "shape": "burst", "size_feet": 10},
                                    {"kind": "save_check", "dc": 18, "save_type": "Reflex", "mode": "standard"},
                                    {"kind": "apply_condition", "condition": "slowed", "value": 1},
                                ],
                            }
                        ],
                    }
                ]
            }
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(model, tmp)
            model_path = tmp.name

        try:
            state = battle_state_from_scenario(scenario)
            rng = DeterministicRNG(seed=state.seed)
            state, events = apply_command(
                state,
                {
                    "type": "trigger_hazard_source",
                    "actor": "hazard_core",
                    "hazard_id": "burst-demo",
                    "source_name": "Burst",
                    "source_type": "trigger_action",
                    "center_x": 2,
                    "center_y": 2,
                    "model_path": model_path,
                },
                rng,
            )
            target_ids = events[0]["payload"]["target_ids"]
            self.assertIn("pc_near", target_ids)
            self.assertNotIn("pc_far", target_ids)
        finally:
            os.unlink(model_path)

    def test_trigger_hazard_source_burst_clips_behind_obstacles(self) -> None:
        scenario = {
            "battle_id": "burst_clipping",
            "seed": 1001,
            "map": {"width": 10, "height": 10, "blocked": [[4, 3]]},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                    "fortitude": 0,
                    "reflex": 0,
                    "will": 0,
                },
                {
                    "id": "pc_clear",
                    "team": "pc",
                    "hp": 20,
                    "position": [3, 5],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
                {
                    "id": "pc_behind_wall",
                    "team": "pc",
                    "hp": 20,
                    "position": [5, 3],
                    "initiative": 9,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
            ],
            "commands": [],
        }
        model = {
            "hazards": {
                "entries": [
                    {
                        "hazard_id": "burst-clip-demo",
                        "hazard_name": "Burst Clip Demo",
                        "sources": [
                            {
                                "source_type": "trigger_action",
                                "source_name": "Burst",
                                "effects": [
                                    {"kind": "area", "shape": "burst", "size_feet": 15},
                                    {"kind": "apply_condition", "condition": "slowed", "value": 1},
                                ],
                            }
                        ],
                    }
                ]
            }
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(model, tmp)
            model_path = tmp.name

        try:
            state = battle_state_from_scenario(scenario)
            rng = DeterministicRNG(seed=state.seed)
            state, events = apply_command(
                state,
                {
                    "type": "trigger_hazard_source",
                    "actor": "hazard_core",
                    "hazard_id": "burst-clip-demo",
                    "source_name": "Burst",
                    "source_type": "trigger_action",
                    "center_x": 3,
                    "center_y": 3,
                    "model_path": model_path,
                },
                rng,
            )
            target_ids = events[0]["payload"]["target_ids"]
            self.assertIn("pc_clear", target_ids)
            self.assertNotIn("pc_behind_wall", target_ids)
        finally:
            os.unlink(model_path)

    def test_area_save_damage_clips_behind_obstacles(self) -> None:
        scenario = {
            "battle_id": "area_save_damage_clipping",
            "seed": 1234,
            "map": {"width": 8, "height": 8, "blocked": [[2, 1]]},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [0, 0],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 5,
                    "reflex": 6,
                    "will": 7,
                },
                {
                    "id": "enemy_clear",
                    "team": "enemy",
                    "hp": 20,
                    "position": [1, 3],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
                {
                    "id": "enemy_blocked",
                    "team": "enemy",
                    "hp": 20,
                    "position": [3, 1],
                    "initiative": 9,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d6+2",
                    "fortitude": 2,
                    "reflex": 2,
                    "will": 2,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "area_save_damage",
                "actor": "caster",
                "center_x": 1,
                "center_y": 1,
                "radius_feet": 15,
                "dc": 18,
                "save_type": "Reflex",
                "damage": "2d6",
                "mode": "basic",
            },
            rng,
        )
        targets = events[0]["payload"]["targets"]
        self.assertIn("enemy_clear", targets)
        self.assertNotIn("enemy_blocked", targets)

    def test_run_hazard_routine_nearest_enemy_area_center(self) -> None:
        scenario = {
            "battle_id": "routine_area_center",
            "seed": 2020,
            "map": {"width": 12, "height": 12, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [3, 3],
                    "initiative": 30,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                    "fortitude": 0,
                    "reflex": 0,
                    "will": 0,
                },
                {
                    "id": "pc_a",
                    "team": "pc",
                    "hp": 30,
                    "position": [4, 3],
                    "initiative": 10,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 6,
                    "reflex": 5,
                    "will": 4,
                },
                {
                    "id": "pc_b",
                    "team": "pc",
                    "hp": 30,
                    "position": [5, 3],
                    "initiative": 9,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "fortitude": 6,
                    "reflex": 6,
                    "will": 4,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "run_hazard_routine",
                "actor": "hazard_core",
                "hazard_id": "fireball-rune",
                "source_name": "Fireball",
                "source_type": "trigger_action",
                "target_policy": "nearest_enemy_area_center",
            },
            rng,
        )
        payload = events[0]["payload"]
        self.assertEqual(events[0]["type"], "run_hazard_routine")
        self.assertEqual(payload["target_policy"], "nearest_enemy_area_center")
        self.assertIn("pc_a", payload["target_ids"])
        self.assertIn("pc_b", payload["target_ids"])
        self.assertEqual(state.units["hazard_core"].actions_remaining, 2)

    def test_trigger_hazard_source_skips_immune_modeled_condition(self) -> None:
        scenario = {
            "battle_id": "hazard_condition_immunity",
            "seed": 909,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                },
                {
                    "id": "pc_immune",
                    "team": "pc",
                    "hp": 30,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d8+2",
                    "condition_immunities": ["slowed"],
                },
            ],
            "commands": [],
        }
        model = {
            "hazards": {
                "entries": [
                    {
                        "hazard_id": "condition-immunity-demo",
                        "hazard_name": "Condition Immunity Demo",
                        "sources": [
                            {
                                "source_type": "trigger_action",
                                "source_name": "Lingering Mist",
                                "effects": [
                                    {"kind": "apply_condition", "condition": "slowed", "value": 1},
                                ],
                            }
                        ],
                    }
                ]
            }
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(model, tmp)
            model_path = tmp.name

        try:
            state = battle_state_from_scenario(scenario)
            rng = DeterministicRNG(seed=state.seed)
            state, events = apply_command(
                state,
                {
                    "type": "trigger_hazard_source",
                    "actor": "hazard_core",
                    "hazard_id": "condition-immunity-demo",
                    "source_name": "Lingering Mist",
                    "source_type": "trigger_action",
                    "model_path": model_path,
                },
                rng,
            )
        finally:
            os.unlink(model_path)

        result = events[0]["payload"]["results"][0]
        self.assertEqual(result["target"], "pc_immune")
        self.assertEqual(result["applied_conditions"], [])
        self.assertEqual(result["skipped_conditions"][0]["name"], "slowed")
        self.assertEqual(result["skipped_conditions"][0]["reason"], "condition_immune")
        self.assertNotIn("slowed", state.units["pc_immune"].conditions)

    def test_set_flag_updates_battle_state(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)
        self.assertNotIn("alarm_triggered", state.flags)

        state, events = apply_command(
            state,
            {
                "type": "set_flag",
                "actor": "hazard_core",
                "flag": "alarm_triggered",
                "value": True,
            },
            rng,
        )
        self.assertTrue(state.flags["alarm_triggered"])
        self.assertEqual(events[0]["type"], "set_flag")


if __name__ == "__main__":
    unittest.main()
