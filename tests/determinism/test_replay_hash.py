from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestReplayHash(unittest.TestCase):
    def test_replay_hash_is_stable(self) -> None:
        scenario = Path("scenarios/smoke/hidden_pit_basic.json")
        r1 = run_scenario_file(scenario)
        r2 = run_scenario_file(scenario)
        self.assertEqual(r1["replay_hash"], r2["replay_hash"])
        self.assertEqual(r1["events"], r2["events"])


if __name__ == "__main__":
    unittest.main()
