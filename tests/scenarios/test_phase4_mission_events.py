from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4MissionEvents(unittest.TestCase):
    def test_round_start_mission_event_spawns_unit_and_sets_flag(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_mission_event_spawn_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("mission_event", event_types)
        self.assertIn("spawn_unit", event_types)
        self.assertIn("set_flag", event_types)
        self.assertIn("battle_end", event_types)

        self.assertTrue(result["final_state"]["flags"]["wave_spawned"])
        self.assertIn("hazard_reinforcement_1", result["final_state"]["units"])

        end_event = [e for e in result["events"] if e["type"] == "battle_end"][-1]
        self.assertEqual(end_event["payload"].get("reason"), "objectives")
        self.assertEqual(end_event["payload"].get("outcome"), "victory")


if __name__ == "__main__":
    unittest.main()
