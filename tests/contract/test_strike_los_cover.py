from __future__ import annotations

import unittest

from engine.core.reducer import ReductionError, apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


def _strike_scenario(blocked: list[list[int]], seed: int = 3) -> dict:
    return {
        "battle_id": "strike_los_cover",
        "seed": seed,
        "map": {"width": 8, "height": 8, "blocked": blocked},
        "units": [
            {
                "id": "attacker",
                "team": "pc",
                "hp": 20,
                "position": [1, 1],
                "initiative": 20,
                "attack_mod": 8,
                "ac": 16,
                "damage": "1d1",
            },
            {
                "id": "target",
                "team": "enemy",
                "hp": 20,
                "position": [4, 1],
                "initiative": 10,
                "attack_mod": 6,
                "ac": 16,
                "damage": "1d1",
            },
        ],
        "commands": [],
    }


class TestStrikeLosCover(unittest.TestCase):
    def test_strike_rejected_on_corner_pinch(self) -> None:
        scenario = {
            "battle_id": "strike_corner_block",
            "seed": 1,
            "map": {"width": 5, "height": 5, "blocked": [[2, 1], [1, 2]]},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 20,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 8,
                    "ac": 16,
                    "damage": "1d1",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 20,
                    "position": [2, 2],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 16,
                    "damage": "1d1",
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        with self.assertRaises(ReductionError):
            apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

    def test_strike_applies_cover_bonus_to_dc(self) -> None:
        state = battle_state_from_scenario(_strike_scenario(blocked=[[4, 2]], seed=3))
        rng = DeterministicRNG(seed=state.seed)

        target_hp_before = state.units["target"].hp
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        payload = events[0]["payload"]
        self.assertEqual(payload["roll"]["cover_grade"], "standard")
        self.assertEqual(payload["roll"]["cover_bonus"], 2)
        self.assertEqual(payload["roll"]["base_dc"], 16)
        self.assertEqual(payload["roll"]["dc"], 18)
        self.assertEqual(payload["degree"], "failure")
        self.assertEqual(state.units["target"].hp, target_hp_before)


if __name__ == "__main__":
    unittest.main()
