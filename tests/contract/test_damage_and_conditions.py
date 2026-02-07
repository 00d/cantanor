from __future__ import annotations

import unittest

from engine.core.rng import DeterministicRNG
from engine.rules.conditions import apply_condition, clear_condition, condition_is_immune
from engine.rules.damage import apply_damage_modifiers, apply_damage_to_pool, parse_formula, roll_damage


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

    def test_damage_modifiers_apply_immunity_resistance_and_weakness(self) -> None:
        immune = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={"fire": 5},
            weaknesses={"fire": 3},
            immunities=["fire"],
        )
        self.assertEqual(immune.applied_total, 0)
        self.assertTrue(immune.immune)

        adjusted = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={"fire": 5},
            weaknesses={"fire": 3},
            immunities=[],
        )
        self.assertEqual(adjusted.applied_total, 10)
        self.assertFalse(adjusted.immune)

    def test_damage_modifiers_apply_grouped_type_tags(self) -> None:
        physical = apply_damage_modifiers(
            raw_total=12,
            damage_type="slashing",
            resistances={"physical": 4},
            weaknesses={},
            immunities=[],
        )
        self.assertEqual(physical.applied_total, 8)

        energy = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={},
            weaknesses={"energy": 3},
            immunities=[],
        )
        self.assertEqual(energy.applied_total, 15)

        immune = apply_damage_modifiers(
            raw_total=12,
            damage_type="electricity",
            resistances={},
            weaknesses={},
            immunities=["energy"],
        )
        self.assertEqual(immune.applied_total, 0)
        self.assertTrue(immune.immune)

    def test_damage_modifiers_use_highest_matching_values(self) -> None:
        adjusted = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={"fire": 5, "energy": 3, "all": 1},
            weaknesses={"fire": 4, "energy": 2, "all": 1},
            immunities=[],
        )
        self.assertEqual(adjusted.resistance_total, 5)
        self.assertEqual(adjusted.weakness_total, 4)
        self.assertEqual(adjusted.applied_total, 11)

    def test_damage_modifiers_allow_bypass_of_resistance_and_immunity(self) -> None:
        resisted = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={"fire": 5},
            weaknesses={},
            immunities=[],
            bypass=["fire"],
        )
        self.assertEqual(resisted.applied_total, 12)
        self.assertEqual(resisted.resistance_total, 0)

        immune = apply_damage_modifiers(
            raw_total=12,
            damage_type="fire",
            resistances={},
            weaknesses={},
            immunities=["fire"],
            bypass=["fire"],
        )
        self.assertFalse(immune.immune)
        self.assertEqual(immune.applied_total, 12)

    def test_apply_condition_keeps_highest_value(self) -> None:
        c = apply_condition({}, "frightened", 1)
        c = apply_condition(c, "frightened", 3)
        c = apply_condition(c, "frightened", 2)
        self.assertEqual(c["frightened"], 3)

    def test_clear_condition_removes_key(self) -> None:
        c = apply_condition({}, "unconscious", 1)
        c = clear_condition(c, "unconscious")
        self.assertNotIn("unconscious", c)

    def test_condition_immunity_normalizes_names_and_supports_global_immunity(self) -> None:
        self.assertTrue(condition_is_immune("Frightened", ["frightened"]))
        self.assertTrue(condition_is_immune("Frightened", ["all_conditions"]))
        self.assertFalse(condition_is_immune("Frightened", ["clumsy"]))

    def test_apply_damage_to_pool_consumes_temp_hp_before_hp(self) -> None:
        result = apply_damage_to_pool(hp=20, temp_hp=5, damage_total=9)
        self.assertEqual(result.absorbed_by_temp_hp, 5)
        self.assertEqual(result.hp_loss, 4)
        self.assertEqual(result.new_temp_hp, 0)
        self.assertEqual(result.new_hp, 16)


if __name__ == "__main__":
    unittest.main()
