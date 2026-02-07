from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase6ForecastStrike(unittest.TestCase):
    def test_strike_event_contains_forecast_payload(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase6_forecast_strike_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("strike", event_types)
        self.assertNotIn("command_error", event_types)

        strike = [e for e in result["events"] if e["type"] == "strike"][-1]["payload"]
        forecast = strike.get("forecast")
        self.assertIsInstance(forecast, dict)
        self.assertEqual(forecast["kind"], "strike")
        self.assertEqual(forecast["damage_formula"], "1d8+4")
        self.assertIn("degree_odds", forecast)
        self.assertIn("expected_damage_raw", forecast)


if __name__ == "__main__":
    unittest.main()
