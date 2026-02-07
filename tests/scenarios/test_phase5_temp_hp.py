from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5TempHP(unittest.TestCase):
    def test_temp_hp_absorbs_damage_before_hp(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_temp_hp_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("strike", event_types)
        self.assertNotIn("command_error", event_types)

        strike_event = [e for e in result["events"] if e["type"] == "strike"][-1]
        damage = strike_event["payload"]["damage"]
        self.assertEqual(damage["total"], 20)
        self.assertEqual(damage["temp_hp_absorbed"], 4)
        self.assertEqual(result["final_state"]["units"]["target"]["hp"], 24)


if __name__ == "__main__":
    unittest.main()
