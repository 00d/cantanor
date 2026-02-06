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


if __name__ == "__main__":
    unittest.main()
