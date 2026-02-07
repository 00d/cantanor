from __future__ import annotations

import unittest

from engine.core.forecast import cast_spell_forecast, degree_odds, expected_damage_average, strike_forecast


class TestForecastPayloads(unittest.TestCase):
    def test_degree_odds_sum_to_one(self) -> None:
        odds = degree_odds(modifier=7, dc=18)
        self.assertEqual(set(odds.keys()), {"critical_success", "success", "failure", "critical_failure"})
        self.assertAlmostEqual(sum(odds.values()), 1.0, places=6)

    def test_strike_forecast_expected_raw_damage(self) -> None:
        forecast = strike_forecast(attack_modifier=100, dc=16, damage_formula="10")
        self.assertEqual(forecast["kind"], "strike")
        self.assertAlmostEqual(forecast["degree_odds"]["critical_success"], 0.95, places=6)
        self.assertAlmostEqual(forecast["degree_odds"]["success"], 0.05, places=6)
        self.assertAlmostEqual(forecast["expected_damage_raw"]["per_attack"], 19.5, places=6)

    def test_cast_spell_forecast_basic_multiplier(self) -> None:
        forecast = cast_spell_forecast(save_modifier=-10, dc=30, damage_formula="2d6", mode="basic")
        self.assertEqual(forecast["kind"], "cast_spell")
        self.assertAlmostEqual(forecast["degree_odds"]["critical_failure"], 0.95, places=6)
        self.assertAlmostEqual(forecast["degree_odds"]["failure"], 0.05, places=6)
        self.assertAlmostEqual(forecast["expected_multiplier"], 1.95, places=6)
        self.assertAlmostEqual(forecast["expected_damage_raw"], expected_damage_average("2d6") * 1.95, places=6)


if __name__ == "__main__":
    unittest.main()
