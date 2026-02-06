from __future__ import annotations

import unittest

from engine.core.rng import DeterministicRNG
from engine.rules.checks import resolve_check
from engine.rules.degrees import degree_of_success
from engine.rules.saves import SaveProfile, basic_save_multiplier, resolve_save


class TestChecksAndSaves(unittest.TestCase):
    def test_degree_of_success_with_natural_20_improves(self) -> None:
        result = degree_of_success(total=10, dc=20, die_value=20)
        self.assertEqual(result, "failure")

    def test_degree_of_success_with_natural_1_worsens(self) -> None:
        result = degree_of_success(total=20, dc=10, die_value=1)
        self.assertEqual(result, "success")

    def test_check_is_deterministic_for_seed(self) -> None:
        rng1 = DeterministicRNG(seed=999)
        rng2 = DeterministicRNG(seed=999)
        c1 = resolve_check(rng1, modifier=7, dc=18)
        c2 = resolve_check(rng2, modifier=7, dc=18)
        self.assertEqual((c1.die, c1.total, c1.degree), (c2.die, c2.total, c2.degree))

    def test_save_resolution_uses_selected_modifier(self) -> None:
        rng = DeterministicRNG(seed=7)
        profile = SaveProfile(fortitude=5, reflex=2, will=9)
        result = resolve_save(rng, save_type="Will", profile=profile, dc=20)
        self.assertEqual(result.modifier, 9)

    def test_basic_save_multipliers(self) -> None:
        self.assertEqual(basic_save_multiplier("critical_success"), 0.0)
        self.assertEqual(basic_save_multiplier("success"), 0.5)
        self.assertEqual(basic_save_multiplier("failure"), 1.0)
        self.assertEqual(basic_save_multiplier("critical_failure"), 2.0)


if __name__ == "__main__":
    unittest.main()
