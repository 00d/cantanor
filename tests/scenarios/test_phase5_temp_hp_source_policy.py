from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5TempHPSourcePolicy(unittest.TestCase):
    def test_cross_source_ignore_then_replace(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_temp_hp_source_policy_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        applies = [e for e in result["events"] if e["type"] == "effect_apply"]
        self.assertEqual(len(applies), 3)

        first = applies[0]["payload"]
        self.assertEqual(first["source_key"], "unit:src_a")
        self.assertEqual(first["temp_hp_after"], 5)

        second = applies[1]["payload"]
        self.assertEqual(second["cross_source"], "ignore")
        self.assertEqual(second["decision"], "cross_source_ignored")
        self.assertEqual(second["reason"], "cross_source_policy_ignore")

        third = applies[2]["payload"]
        self.assertEqual(third["cross_source"], "replace")
        self.assertEqual(third["decision"], "cross_source_replaced")
        self.assertEqual(result["final_state"]["units"]["target"]["temp_hp"], 4)
        self.assertEqual(result["final_state"]["units"]["target"]["temp_hp_source"], "unit:src_b")


if __name__ == "__main__":
    unittest.main()
