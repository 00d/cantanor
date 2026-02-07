from __future__ import annotations

import unittest

from engine.core.reducer import apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


def _base_scenario() -> dict:
    return {
        "battle_id": "effect_lifecycle",
        "seed": 123,
        "map": {"width": 5, "height": 5, "blocked": []},
        "units": [
            {
                "id": "pc",
                "team": "pc",
                "hp": 20,
                "position": [0, 0],
                "initiative": 15,
                "attack_mod": 6,
                "ac": 16,
                "damage": "1d8+3",
                "fortitude": 4,
                "reflex": 5,
                "will": 2,
            },
            {
                "id": "enemy",
                "team": "enemy",
                "hp": 18,
                "position": [1, 0],
                "initiative": 10,
                "attack_mod": 5,
                "ac": 15,
                "damage": "1d6+2",
                "fortitude": 2,
                "reflex": 2,
                "will": 2,
            },
        ],
        "commands": [],
    }


class TestEffectLifecycle(unittest.TestCase):
    def test_condition_effect_applies_and_expires(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        # PC applies frightened 2 to enemy for 1 round.
        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "condition",
                "payload": {"name": "frightened", "value": 2, "clear_on_expire": True},
                "duration_rounds": 1,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["enemy"].conditions.get("frightened"), 2)

        # End PC turn -> enemy turn starts.
        state, _ = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        # End enemy turn -> effect duration hits 0 and clears.
        state, events = apply_command(state, {"type": "end_turn", "actor": "enemy"}, rng)

        self.assertNotIn("frightened", state.units["enemy"].conditions)
        self.assertFalse(state.effects)
        self.assertIn("effect_expire", [e["type"] for e in events])

    def test_persistent_damage_ticks_on_turn_start(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        # PC applies persistent damage to enemy.
        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "persistent_damage",
                "payload": {"formula": "1d1", "damage_type": "fire"},
                "duration_rounds": 1,
                "tick_timing": "turn_start",
            },
            rng,
        )
        hp_before = state.units["enemy"].hp

        # Advance to enemy turn start; tick should occur.
        state, events = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        hp_after = state.units["enemy"].hp

        self.assertEqual(hp_after, hp_before - 1)
        self.assertIn("effect_tick", [e["type"] for e in events])

    def test_persistent_damage_recovery_success_expires_effect(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "persistent_damage",
                "payload": {"formula": "1d1", "damage_type": "fire", "recovery_dc": 1},
                "duration_rounds": 10,
                "tick_timing": "turn_start",
            },
            rng,
        )
        effect_ids = list(state.effects.keys())
        self.assertEqual(len(effect_ids), 1)
        effect_id = effect_ids[0]

        state, events = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        self.assertNotIn(effect_id, state.effects)
        event_types = [e["type"] for e in events]
        self.assertIn("effect_tick", event_types)
        self.assertIn("effect_expire", event_types)
        tick = [e for e in events if e["type"] == "effect_tick"][-1]
        self.assertTrue(tick["payload"]["recovery"]["recovered"])

    def test_persistent_damage_recovery_failure_keeps_effect(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "persistent_damage",
                "payload": {"formula": "1d1", "damage_type": "fire", "recovery_dc": 50},
                "duration_rounds": 10,
                "tick_timing": "turn_start",
            },
            rng,
        )
        effect_ids = list(state.effects.keys())
        self.assertEqual(len(effect_ids), 1)
        effect_id = effect_ids[0]

        state, events = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        self.assertIn(effect_id, state.effects)
        tick = [e for e in events if e["type"] == "effect_tick"][-1]
        self.assertFalse(tick["payload"]["recovery"]["recovered"])

    def test_condition_effect_respects_condition_immunity(self) -> None:
        scenario = _base_scenario()
        scenario["units"][1]["condition_immunities"] = ["frightened"]
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "condition",
                "payload": {"name": "frightened", "value": 2, "clear_on_expire": True},
                "duration_rounds": 1,
                "tick_timing": None,
            },
            rng,
        )

        self.assertNotIn("frightened", state.units["enemy"].conditions)
        effect_apply_events = [e for e in events if e["type"] == "effect_apply"]
        self.assertTrue(effect_apply_events)
        payload = effect_apply_events[0]["payload"]
        self.assertFalse(payload["applied"])
        self.assertEqual(payload["reason"], "condition_immune")

    def test_persistent_damage_consumes_temp_hp_before_hp(self) -> None:
        scenario = _base_scenario()
        scenario["units"][1]["temp_hp"] = 1
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "persistent_damage",
                "payload": {"formula": "2", "damage_type": "fire", "recovery_check": False},
                "duration_rounds": 1,
                "tick_timing": "turn_start",
            },
            rng,
        )
        state, events = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        tick = [e for e in events if e["type"] == "effect_tick"][-1]["payload"]
        self.assertEqual(tick["damage"]["total"], 2)
        self.assertEqual(tick["damage"]["temp_hp_absorbed"], 1)
        self.assertEqual(state.units["enemy"].temp_hp, 0)
        self.assertEqual(state.units["enemy"].hp, 17)

    def test_temp_hp_effect_grants_temp_hp(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["enemy"].temp_hp, 5)
        effect_apply = [e for e in events if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["requested_amount"], 5)
        self.assertEqual(effect_apply["temp_hp_before"], 0)
        self.assertEqual(effect_apply["temp_hp_after"], 5)
        self.assertTrue(effect_apply["applied"])

    def test_temp_hp_effect_does_not_reduce_existing_temp_hp(self) -> None:
        scenario = _base_scenario()
        scenario["units"][1]["temp_hp"] = 7
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["enemy"].temp_hp, 7)
        effect_apply = [e for e in events if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["temp_hp_before"], 7)
        self.assertEqual(effect_apply["temp_hp_after"], 7)
        self.assertEqual(effect_apply["granted"], 0)
        self.assertFalse(effect_apply["applied"])

    def test_temp_hp_effect_add_stack_mode_increases_existing_temp_hp(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 2, "stack_mode": "add"},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5, "stack_mode": "add"},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["enemy"].temp_hp, 7)
        effect_apply = [e for e in events if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["stack_mode"], "add")
        self.assertEqual(effect_apply["decision"], "same_source_refresh")
        self.assertEqual(effect_apply["granted"], 5)
        self.assertTrue(effect_apply["applied"])

    def test_temp_hp_effect_cross_source_higher_only_keeps_stronger_pool(self) -> None:
        scenario = {
            "battle_id": "temp_hp_cross_source_higher_only",
            "seed": 991,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "src_a",
                    "team": "pc",
                    "hp": 20,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 4,
                    "ac": 16,
                    "damage": "1",
                },
                {
                    "id": "src_b",
                    "team": "pc",
                    "hp": 20,
                    "position": [1, 2],
                    "initiative": 10,
                    "attack_mod": 4,
                    "ac": 16,
                    "damage": "1",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 20,
                    "position": [2, 1],
                    "initiative": 5,
                    "attack_mod": 4,
                    "ac": 16,
                    "damage": "1",
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "src_a",
                "target": "target",
                "effect_kind": "temp_hp",
                "payload": {"amount": 7},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        state, _ = apply_command(state, {"type": "end_turn", "actor": "src_a"}, rng)
        state, events = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "src_b",
                "target": "target",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5},
                "duration_rounds": None,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["target"].temp_hp, 7)
        self.assertEqual(state.units["target"].temp_hp_source, "unit:src_a")
        effect_apply = [e for e in events if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["decision"], "cross_source_ignored")
        self.assertEqual(effect_apply["reason"], "lower_or_equal_than_current")

    def test_temp_hp_effect_expire_removes_remaining_temp_hp(self) -> None:
        state = battle_state_from_scenario(_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5, "remove_on_expire": True},
                "duration_rounds": 1,
                "tick_timing": None,
            },
            rng,
        )
        self.assertEqual(state.units["enemy"].temp_hp, 5)

        state, _ = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        state, events = apply_command(state, {"type": "end_turn", "actor": "enemy"}, rng)

        self.assertEqual(state.units["enemy"].temp_hp, 0)
        expire_events = [e for e in events if e["type"] == "effect_expire"]
        self.assertTrue(expire_events)
        expire = expire_events[-1]["payload"]
        self.assertEqual(expire["kind"], "temp_hp")
        self.assertEqual(expire["removed_temp_hp"], 5)
        self.assertEqual(expire["temp_hp_after"], 0)

    def test_temp_hp_effect_expire_after_partial_absorption(self) -> None:
        scenario = _base_scenario()
        scenario["units"][0]["attack_mod"] = 100
        scenario["units"][0]["damage"] = "1"
        scenario["units"][1]["ac"] = 10
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, _ = apply_command(
            state,
            {
                "type": "apply_effect",
                "actor": "pc",
                "target": "enemy",
                "effect_kind": "temp_hp",
                "payload": {"amount": 5, "remove_on_expire": True},
                "duration_rounds": 1,
                "tick_timing": None,
            },
            rng,
        )
        state, strike_events = apply_command(state, {"type": "strike", "actor": "pc", "target": "enemy"}, rng)
        strike_damage = [e for e in strike_events if e["type"] == "strike"][-1]["payload"]["damage"]
        absorbed = int(strike_damage["temp_hp_absorbed"])
        self.assertGreater(absorbed, 0)
        self.assertLess(absorbed, 5)
        remaining = 5 - absorbed
        self.assertEqual(state.units["enemy"].temp_hp, remaining)

        state, _ = apply_command(state, {"type": "end_turn", "actor": "pc"}, rng)
        state, events = apply_command(state, {"type": "end_turn", "actor": "enemy"}, rng)

        self.assertEqual(state.units["enemy"].temp_hp, 0)
        expire = [e for e in events if e["type"] == "effect_expire"][-1]["payload"]
        self.assertEqual(expire["removed_temp_hp"], remaining)


if __name__ == "__main__":
    unittest.main()
