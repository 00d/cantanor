from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase9EnemyPolicyRationale(unittest.TestCase):
    def test_enemy_policy_decision_includes_rationale_when_enabled(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase9_enemy_policy_rationale_basic.json"))

        event_types = [e["type"] for e in result["events"]]
        self.assertIn("enemy_policy_decision", event_types)
        self.assertIn("cast_spell", event_types)
        self.assertNotIn("command_error", event_types)

        decision = [e for e in result["events"] if e["type"] == "enemy_policy_decision"][-1]["payload"]
        self.assertIn("rationale", decision)
        self.assertEqual(decision["command"]["type"], "cast_spell")
        self.assertEqual(decision["command"]["spell_id"], "arc_flash")

        rationale = decision["rationale"]
        self.assertEqual(rationale["reason_code"], "nearest_enemy_for_spell")
        self.assertEqual(rationale["selected_target"], "pc_target")
        self.assertEqual(rationale["distance"], 1)
        self.assertEqual(rationale["candidate_count"], 1)


if __name__ == "__main__":
    unittest.main()
