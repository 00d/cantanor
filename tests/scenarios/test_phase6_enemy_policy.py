from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase6EnemyPolicy(unittest.TestCase):
    def test_enemy_policy_resolves_non_scripted_duel(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase6_enemy_policy_duel_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("enemy_policy_decision", event_types)
        self.assertNotIn("command_error", event_types)
        self.assertGreater(result["auto_executed_commands"], 0)
        self.assertEqual(result["stop_reason"], "battle_end")


if __name__ == "__main__":
    unittest.main()
