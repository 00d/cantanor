from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4MissionBranchingWaves(unittest.TestCase):
    def test_branch_else_path_selects_low_wave(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_mission_branching_waves_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("mission_event", event_types)
        self.assertIn("spawn_unit", event_types)
        self.assertIn("battle_end", event_types)

        mission_events = [e for e in result["events"] if e["type"] == "mission_event"]
        mission_payload_by_id = {e["payload"]["id"]: e["payload"] for e in mission_events}
        self.assertEqual(mission_payload_by_id["branch_route"]["branch"], "else")
        self.assertEqual(mission_payload_by_id["wave_low"]["branch"], "default")
        self.assertNotIn("wave_high", mission_payload_by_id)

        spawn_unit_ids = [e["payload"]["unit_id"] for e in result["events"] if e["type"] == "spawn_unit"]
        self.assertIn("hazard_wave_low", spawn_unit_ids)
        self.assertNotIn("hazard_wave_high", spawn_unit_ids)

        self.assertTrue(result["final_state"]["flags"]["route_low"])
        self.assertFalse(result["final_state"]["flags"]["route_high"])
        self.assertTrue(result["final_state"]["flags"]["wave_low_spawned"])
        self.assertFalse(result["final_state"]["flags"]["wave_high_spawned"])
        self.assertIn("hazard_wave_low", result["final_state"]["units"])
        self.assertNotIn("hazard_wave_high", result["final_state"]["units"])

        end_event = [e for e in result["events"] if e["type"] == "battle_end"][-1]
        self.assertEqual(end_event["payload"].get("reason"), "objectives")
        self.assertEqual(end_event["payload"].get("outcome"), "victory")


if __name__ == "__main__":
    unittest.main()
