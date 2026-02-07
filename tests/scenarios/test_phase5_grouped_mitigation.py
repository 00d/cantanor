from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5GroupedMitigation(unittest.TestCase):
    def test_grouped_damage_types_apply_expected_modifiers(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_grouped_mitigation_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("save_damage", event_types)
        self.assertIn("strike", event_types)
        self.assertNotIn("command_error", event_types)

        save_event = [e for e in result["events"] if e["type"] == "save_damage"][-1]
        save_damage = save_event["payload"]["damage"]
        self.assertEqual(save_damage["damage_type"], "fire")
        self.assertEqual(save_damage["weakness_total"], 2)
        self.assertEqual(save_damage["applied_total"], save_damage["raw_total"] + 2)

        strike_event = [e for e in result["events"] if e["type"] == "strike"][-1]
        strike_damage = strike_event["payload"]["damage"]
        self.assertEqual(strike_damage["damage_type"], "slashing")
        self.assertEqual(strike_damage["resistance_total"], 4)
        self.assertEqual(strike_damage["total"], max(0, strike_damage["raw_total"] - 4))


if __name__ == "__main__":
    unittest.main()
