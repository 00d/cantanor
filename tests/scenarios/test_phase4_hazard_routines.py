from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4HazardRoutines(unittest.TestCase):
    def test_auto_hazard_routine_executes_without_scripted_command(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_hazard_routine_auto_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("run_hazard_routine", event_types)
        self.assertNotIn("command_error", event_types)
        self.assertGreaterEqual(result["auto_executed_commands"], 1)
        self.assertLessEqual(result["executed_commands"], 1)

    def test_auto_hazard_routine_executes_with_zero_scripted_commands(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_hazard_routine_no_script_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("run_hazard_routine", event_types)
        self.assertNotIn("command_error", event_types)
        self.assertEqual(result["executed_commands"], 0)
        self.assertGreaterEqual(result["auto_executed_commands"], 1)
        self.assertIn(result["stop_reason"], {"battle_end", "script_exhausted"})


if __name__ == "__main__":
    unittest.main()
