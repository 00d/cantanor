from __future__ import annotations

import unittest

from engine.io.scenario_loader import battle_state_from_scenario
from engine.grid.loe import cover_ac_bonus_between_tiles, cover_grade_between_tiles, has_tile_line_of_effect


def _scenario(blocked: list[list[int]]) -> dict:
    return {
        "battle_id": "line_of_effect",
        "seed": 111,
        "map": {"width": 8, "height": 8, "blocked": blocked},
        "units": [
            {
                "id": "a",
                "team": "pc",
                "hp": 10,
                "position": [1, 1],
                "initiative": 20,
                "attack_mod": 0,
                "ac": 10,
                "damage": "1d1",
            },
            {
                "id": "b",
                "team": "enemy",
                "hp": 10,
                "position": [5, 1],
                "initiative": 10,
                "attack_mod": 0,
                "ac": 10,
                "damage": "1d1",
            },
        ],
        "commands": [],
    }


class TestLineOfEffect(unittest.TestCase):
    def test_has_tile_line_of_effect_true_when_clear(self) -> None:
        state = battle_state_from_scenario(_scenario(blocked=[]))
        self.assertTrue(has_tile_line_of_effect(state, 1, 1, 5, 1))

    def test_has_tile_line_of_effect_false_when_blocked(self) -> None:
        state = battle_state_from_scenario(_scenario(blocked=[[3, 1]]))
        self.assertFalse(has_tile_line_of_effect(state, 1, 1, 5, 1))

    def test_has_tile_line_of_effect_false_when_diagonal_corner_pinched(self) -> None:
        state = battle_state_from_scenario(_scenario(blocked=[[2, 1], [1, 2]]))
        self.assertFalse(has_tile_line_of_effect(state, 1, 1, 2, 2))

    def test_cover_grade_standard_and_greater(self) -> None:
        standard = battle_state_from_scenario(_scenario(blocked=[[5, 0]]))
        self.assertEqual(cover_grade_between_tiles(standard, 1, 1, 5, 1), "standard")
        self.assertEqual(cover_ac_bonus_between_tiles(standard, 1, 1, 5, 1), 2)

        greater = battle_state_from_scenario(_scenario(blocked=[[5, 0], [5, 2]]))
        self.assertEqual(cover_grade_between_tiles(greater, 1, 1, 5, 1), "greater")
        self.assertEqual(cover_ac_bonus_between_tiles(greater, 1, 1, 5, 1), 4)


if __name__ == "__main__":
    unittest.main()
