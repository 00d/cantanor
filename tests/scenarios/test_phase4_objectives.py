from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4Objectives(unittest.TestCase):
    def test_flag_objective_ends_battle_with_victory(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_objective_flag_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("objective_update", event_types)
        self.assertIn("battle_end", event_types)

        end_event = [e for e in result["events"] if e["type"] == "battle_end"][-1]
        self.assertEqual(end_event["payload"].get("reason"), "objectives")
        self.assertEqual(end_event["payload"].get("outcome"), "victory")
        self.assertTrue(result["final_state"]["flags"]["gate_open"])


if __name__ == "__main__":
    unittest.main()
