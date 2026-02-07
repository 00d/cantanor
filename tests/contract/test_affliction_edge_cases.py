from __future__ import annotations

import unittest

from engine.core.reducer import apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


def _scenario(seed: int = 777) -> dict:
    return {
        "battle_id": "affliction_edge_cases",
        "seed": seed,
        "map": {"width": 8, "height": 8, "blocked": []},
        "units": [
            {
                "id": "caster",
                "team": "pc",
                "hp": 30,
                "position": [1, 1],
                "initiative": 20,
                "attack_mod": 8,
                "ac": 16,
                "damage": "1d1",
                "fortitude": 5,
                "reflex": 5,
                "will": 5,
            },
            {
                "id": "target",
                "team": "enemy",
                "hp": 20,
                "position": [2, 1],
                "initiative": 10,
                "attack_mod": 6,
                "ac": 16,
                "damage": "1d1",
                "fortitude": 0,
                "reflex": 0,
                "will": 0,
            },
        ],
        "commands": [],
    }


class TestAfflictionEdgeCases(unittest.TestCase):
    def test_stage_duration_delays_affliction_progression(self) -> None:
        state = battle_state_from_scenario(_scenario(seed=222))
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "delay_test",
                    "save": {"dc": 99, "save_type": "Fortitude"},
                    "maximum_duration": {"amount": 8, "unit": "round"},
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [{"formula": "1d1", "damage_type": "poison"}],
                            "conditions": [{"condition": "clumsy", "value": 1}],
                            "duration": {"amount": 2, "unit": "round"},
                        },
                        {
                            "stage": 2,
                            "damage": [{"formula": "1d1", "damage_type": "poison"}],
                            "conditions": [{"condition": "clumsy", "value": 2}],
                            "duration": {"amount": 2, "unit": "round"},
                        },
                    ],
                    "current_stage": 1,
                },
                "duration_rounds": 8,
                "tick_timing": "turn_end",
            },
            rng,
        )
        self.assertEqual(state.units["target"].hp, 19)
        self.assertEqual(state.units["target"].conditions.get("clumsy"), 1)

        state, _ = apply_command(state, {"type": "end_turn", "actor": "caster"}, rng)
        hp_before_wait_tick = state.units["target"].hp
        state, events = apply_command(state, {"type": "end_turn", "actor": "target"}, rng)
        self.assertEqual(state.units["target"].hp, hp_before_wait_tick)
        tick_events = [e for e in events if e["type"] == "effect_tick"]
        self.assertTrue(tick_events and tick_events[0]["payload"].get("waiting"))

        state, _ = apply_command(state, {"type": "end_turn", "actor": "caster"}, rng)
        hp_before_progress_tick = state.units["target"].hp
        state, events = apply_command(state, {"type": "end_turn", "actor": "target"}, rng)
        self.assertEqual(state.units["target"].hp, hp_before_progress_tick - 1)
        self.assertEqual(state.units["target"].conditions.get("clumsy"), 2)
        tick_events = [e for e in events if e["type"] == "effect_tick"]
        self.assertTrue(tick_events and not tick_events[0]["payload"].get("waiting", False))

    def test_persistent_condition_survives_affliction_expire(self) -> None:
        scenario = _scenario(seed=333)
        scenario["units"][1]["fortitude"] = 100
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "persistence_test",
                    "save": {"dc": 1, "save_type": "Fortitude"},
                    "maximum_duration": {"amount": 4, "unit": "round"},
                    "persistent_conditions": ["drained"],
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [],
                            "conditions": [
                                {"condition": "drained", "value": 1},
                                {"condition": "sickened", "value": 1},
                            ],
                            "duration": {"amount": 1, "unit": "round"},
                        }
                    ],
                    "current_stage": 1,
                },
                "duration_rounds": 4,
                "tick_timing": "turn_end",
            },
            rng,
        )
        self.assertEqual(state.units["target"].conditions.get("drained"), 1)
        self.assertEqual(state.units["target"].conditions.get("sickened"), 1)

        state, _ = apply_command(state, {"type": "end_turn", "actor": "caster"}, rng)
        state, events = apply_command(state, {"type": "end_turn", "actor": "target"}, rng)

        self.assertEqual(state.units["target"].conditions.get("drained"), 1)
        self.assertNotIn("sickened", state.units["target"].conditions)
        self.assertFalse(state.effects)
        self.assertIn("effect_expire", [e["type"] for e in events])

    def test_stage_recovery_can_reduce_condition_value(self) -> None:
        scenario = _scenario(seed=101)
        scenario["units"][1]["fortitude"] = 0
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "recovery_test",
                    "save": {"dc": 10, "save_type": "Fortitude"},
                    "maximum_duration": {"amount": 6, "unit": "round"},
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [],
                            "conditions": [{"condition": "clumsy", "value": 1}],
                            "duration": {"amount": 1, "unit": "round"},
                        },
                        {
                            "stage": 2,
                            "damage": [],
                            "conditions": [{"condition": "clumsy", "value": 2}],
                            "duration": {"amount": 1, "unit": "round"},
                        },
                    ],
                    "current_stage": 2,
                },
                "duration_rounds": 6,
                "tick_timing": "turn_end",
            },
            rng,
        )
        self.assertEqual(state.units["target"].conditions.get("clumsy"), 2)

        state, _ = apply_command(state, {"type": "end_turn", "actor": "caster"}, rng)
        state, events = apply_command(state, {"type": "end_turn", "actor": "target"}, rng)
        self.assertEqual(state.units["target"].conditions.get("clumsy"), 1)
        tick = [e for e in events if e["type"] == "effect_tick"][0]["payload"]
        self.assertEqual(tick["stage_from"], 2)
        self.assertEqual(tick["stage_to"], 1)

    def test_affliction_stage_skips_condition_when_target_is_immune(self) -> None:
        scenario = _scenario(seed=404)
        scenario["units"][1]["condition_immunities"] = ["clumsy"]
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "immune_stage_test",
                    "save": {"dc": 99, "save_type": "Fortitude"},
                    "maximum_duration": {"amount": 2, "unit": "round"},
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [],
                            "conditions": [{"condition": "clumsy", "value": 2}],
                            "duration": {"amount": 1, "unit": "round"},
                        }
                    ],
                    "current_stage": 1,
                },
                "duration_rounds": 2,
                "tick_timing": "turn_end",
            },
            rng,
        )

        self.assertNotIn("clumsy", state.units["target"].conditions)
        apply_events = [e for e in events if e["type"] == "effect_apply"]
        self.assertTrue(apply_events)
        stage_result = apply_events[0]["payload"]["stage_result"]
        self.assertEqual(stage_result["skipped_conditions"][0]["name"], "clumsy")
        self.assertEqual(stage_result["skipped_conditions"][0]["reason"], "condition_immune")

    def test_affliction_stage_damage_uses_mitigation_modifiers(self) -> None:
        scenario = _scenario(seed=505)
        scenario["units"][1]["resistances"] = {"poison": 4}
        scenario["units"][1]["weaknesses"] = {"poison": 1}
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "mitigation_stage_test",
                    "maximum_duration": {"amount": 2, "unit": "round"},
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [{"formula": "10", "damage_type": "poison"}],
                            "conditions": [],
                            "duration": {"amount": 1, "unit": "round"},
                        }
                    ],
                    "current_stage": 1,
                },
                "duration_rounds": 2,
                "tick_timing": "turn_end",
            },
            rng,
        )

        self.assertEqual(state.units["target"].hp, 13)
        apply_events = [e for e in events if e["type"] == "effect_apply"]
        self.assertTrue(apply_events)
        damage = apply_events[0]["payload"]["stage_result"]["damage"][0]
        self.assertEqual(damage["raw_total"], 10)
        self.assertEqual(damage["resistance_total"], 4)
        self.assertEqual(damage["weakness_total"], 1)
        self.assertEqual(damage["total"], 7)

    def test_affliction_stage_damage_can_bypass_matching_immunity(self) -> None:
        scenario = _scenario(seed=506)
        scenario["units"][1]["immunities"] = ["poison"]
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "caster",
                "target": "target",
                "effect_kind": "affliction",
                "payload": {
                    "name": "bypass_stage_test",
                    "maximum_duration": {"amount": 2, "unit": "round"},
                    "stages": [
                        {
                            "stage": 1,
                            "damage": [{"formula": "10", "damage_type": "poison", "bypass": ["poison"]}],
                            "conditions": [],
                            "duration": {"amount": 1, "unit": "round"},
                        }
                    ],
                    "current_stage": 1,
                },
                "duration_rounds": 2,
                "tick_timing": "turn_end",
            },
            rng,
        )

        self.assertEqual(state.units["target"].hp, 10)
        apply_events = [e for e in events if e["type"] == "effect_apply"]
        self.assertTrue(apply_events)
        damage = apply_events[0]["payload"]["stage_result"]["damage"][0]
        self.assertEqual(damage["bypass"], ["poison"])
        self.assertFalse(damage["immune"])
        self.assertEqual(damage["total"], 10)


if __name__ == "__main__":
    unittest.main()
