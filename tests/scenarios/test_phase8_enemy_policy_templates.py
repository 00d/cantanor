from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase8EnemyPolicyTemplates(unittest.TestCase):
    def test_enemy_policy_uses_pack_spell_template(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase8_enemy_policy_pack_spell_basic.json"))

        event_types = [e["type"] for e in result["events"]]
        self.assertIn("enemy_policy_decision", event_types)
        self.assertIn("cast_spell", event_types)
        self.assertNotIn("command_error", event_types)

        decision = [e for e in result["events"] if e["type"] == "enemy_policy_decision"][-1]["payload"]
        self.assertEqual(decision["command"]["type"], "cast_spell")
        self.assertEqual(decision["command"]["spell_id"], "arc_flash")

        cast_event = [e for e in result["events"] if e["type"] == "cast_spell"][-1]["payload"]
        self.assertEqual(cast_event["actor"], "enemy_caster")
        self.assertEqual(cast_event["spell_id"], "arc_flash")
        self.assertEqual(cast_event["save_type"], "Reflex")


if __name__ == "__main__":
    unittest.main()
