from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5DamageMitigation(unittest.TestCase):
    def test_save_damage_respects_resistance_and_weakness(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_damage_mitigation_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("save_damage", event_types)
        self.assertNotIn("command_error", event_types)

        save_event = [e for e in result["events"] if e["type"] == "save_damage"][-1]
        damage = save_event["payload"]["damage"]
        self.assertEqual(damage["damage_type"], "fire")
        self.assertEqual(damage["resistance_total"], 5)
        self.assertEqual(damage["weakness_total"], 3)
        self.assertEqual(damage["applied_total"], max(0, damage["raw_total"] - 5 + 3))
        self.assertEqual(result["final_state"]["units"]["target"]["hp"], 40 - damage["applied_total"])


if __name__ == "__main__":
    unittest.main()
