from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4MissionTriggerUnitDead(unittest.TestCase):
    def test_unit_dead_trigger_executes_casualty_hook(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_mission_trigger_unit_dead_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("mission_event", event_types)
        self.assertIn("set_flag", event_types)
        self.assertIn("battle_end", event_types)
        self.assertNotIn("command_error", event_types)

        mission_event = [e for e in result["events"] if e["type"] == "mission_event"][-1]
        self.assertEqual(mission_event["payload"].get("id"), "casualty_hook")
        self.assertEqual(mission_event["payload"].get("branch"), "default")

        self.assertTrue(result["final_state"]["flags"]["casualty_confirmed"])
        self.assertFalse(result["final_state"]["units"]["pc_low"]["alive"])
        self.assertTrue(result["final_state"]["units"]["pc_tank"]["alive"])

        end_event = [e for e in result["events"] if e["type"] == "battle_end"][-1]
        self.assertEqual(end_event["payload"].get("reason"), "objectives")
        self.assertEqual(end_event["payload"].get("outcome"), "victory")


if __name__ == "__main__":
    unittest.main()
