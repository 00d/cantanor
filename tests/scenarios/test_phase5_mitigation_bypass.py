from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5MitigationBypass(unittest.TestCase):
    def test_damage_bypass_ignores_matching_resistance_and_immunity(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_mitigation_bypass_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("save_damage", event_types)
        self.assertIn("strike", event_types)
        self.assertIn("area_save_damage", event_types)
        self.assertNotIn("command_error", event_types)

        strike_event = [e for e in result["events"] if e["type"] == "strike"][-1]
        strike_damage = strike_event["payload"]["damage"]
        self.assertEqual(strike_damage["damage_type"], "fire")
        self.assertEqual(strike_damage["bypass"], ["fire"])
        self.assertFalse(strike_damage["immune"])
        self.assertEqual(strike_damage["resistance_total"], 0)
        self.assertEqual(strike_damage["total"], strike_damage["raw_total"])

        save_event = [e for e in result["events"] if e["type"] == "save_damage"][-1]
        save_damage = save_event["payload"]["damage"]
        self.assertEqual(save_damage["damage_type"], "fire")
        self.assertEqual(save_damage["bypass"], ["fire"])
        self.assertFalse(save_damage["immune"])
        self.assertGreater(save_damage["applied_total"], 0)

        area_event = [e for e in result["events"] if e["type"] == "area_save_damage"][-1]
        area_results = {entry["target"]: entry for entry in area_event["payload"]["resolutions"]}
        self.assertIn("target_area", area_results)
        area_damage = area_results["target_area"]["damage"]
        self.assertEqual(area_damage["bypass"], ["fire"])
        self.assertFalse(area_damage["immune"])
        self.assertGreater(area_damage["applied_total"], 0)


if __name__ == "__main__":
    unittest.main()
