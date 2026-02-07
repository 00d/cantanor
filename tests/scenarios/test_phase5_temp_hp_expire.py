from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5TempHPExpire(unittest.TestCase):
    def test_temp_hp_effect_expires_and_removes_granted_pool(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_temp_hp_expire_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_apply", event_types)
        self.assertIn("effect_expire", event_types)
        self.assertNotIn("command_error", event_types)

        effect_apply = [e for e in result["events"] if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["kind"], "temp_hp")
        self.assertEqual(effect_apply["temp_hp_after"], 5)

        effect_expire = [e for e in result["events"] if e["type"] == "effect_expire"][-1]["payload"]
        self.assertEqual(effect_expire["kind"], "temp_hp")
        self.assertEqual(effect_expire["removed_temp_hp"], 5)
        self.assertEqual(result["final_state"]["units"]["buffer"]["temp_hp"], 0)


if __name__ == "__main__":
    unittest.main()
