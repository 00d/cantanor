from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase4HazardRoutineCadence(unittest.TestCase):
    def test_cadence_and_max_triggers_limit_routine_runs(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase4_hazard_routine_cadence_basic.json"))
        routine_events = [e for e in result["events"] if e["type"] == "run_hazard_routine"]
        self.assertEqual(len(routine_events), 2)
        self.assertEqual([e["round"] for e in routine_events], [1, 3])
        self.assertNotIn("command_error", [e["type"] for e in result["events"]])


if __name__ == "__main__":
    unittest.main()
