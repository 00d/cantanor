from __future__ import annotations

import json
import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


REGRESSION_DIR = Path("scenarios/regression_phase6")
EXPECTED_PATH = REGRESSION_DIR / "expected_hashes.json"


class TestPhase6RegressionMatrix(unittest.TestCase):
    def test_regression_hashes_and_no_command_errors(self) -> None:
        scenarios = sorted(REGRESSION_DIR.glob("[0-9][0-9]_*.json"))
        self.assertGreaterEqual(len(scenarios), 5, "expected at least 5 phase 6 regression scenarios")

        expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
        self.assertEqual(sorted(expected.keys()), [s.name for s in scenarios])

        for scenario in scenarios:
            with self.subTest(scenario=scenario.name):
                result1 = run_scenario_file(scenario)
                result2 = run_scenario_file(scenario)
                self.assertEqual(result1["replay_hash"], result2["replay_hash"])
                self.assertEqual(result1["replay_hash"], expected[scenario.name])
                event_types = [e["type"] for e in result1["events"]]
                self.assertNotIn("command_error", event_types)


if __name__ == "__main__":
    unittest.main()
