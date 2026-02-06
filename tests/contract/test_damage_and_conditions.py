from __future__ import annotations

import unittest

from engine.core.rng import DeterministicRNG
from engine.rules.conditions import apply_condition, clear_condition
from engine.rules.damage import parse_formula, roll_damage


class TestDamageAndConditions(unittest.TestCase):
    def test_damage_formula_parser(self) -> None:
        count, size, mod = parse_formula("2d6+3")
        self.assertEqual((count, size, mod), (2, 6, 3))
        count, size, mod = parse_formula("10")
        self.assertEqual((count, size, mod), (0, 1, 10))

    def test_damage_roll_is_deterministic(self) -> None:
        rng1 = DeterministicRNG(seed=42)
        rng2 = DeterministicRNG(seed=42)
        r1 = roll_damage(rng1, "1d8+2")
        r2 = roll_damage(rng2, "1d8+2")
        self.assertEqual((r1.total, r1.rolls), (r2.total, r2.rolls))

    def test_apply_condition_keeps_highest_value(self) -> None:
        c = apply_condition({}, "frightened", 1)
        c = apply_condition(c, "frightened", 3)
        c = apply_condition(c, "frightened", 2)
        self.assertEqual(c["frightened"], 3)

    def test_clear_condition_removes_key(self) -> None:
        c = apply_condition({}, "unconscious", 1)
        c = clear_condition(c, "unconscious")
        self.assertNotIn("unconscious", c)


if __name__ == "__main__":
    unittest.main()
