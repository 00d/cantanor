from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5TempHPEffect(unittest.TestCase):
    def test_temp_hp_effect_grants_and_absorbs_in_later_hit(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_temp_hp_effect_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_apply", event_types)
        self.assertIn("strike", event_types)
        self.assertNotIn("command_error", event_types)

        effect_apply = [e for e in result["events"] if e["type"] == "effect_apply"][0]["payload"]
        self.assertEqual(effect_apply["kind"], "temp_hp")
        self.assertEqual(effect_apply["temp_hp_after"], 5)

        strike = [e for e in result["events"] if e["type"] == "strike"][-1]["payload"]
        self.assertEqual(strike["damage"]["total"], 12)
        self.assertEqual(strike["damage"]["temp_hp_absorbed"], 5)
        self.assertEqual(result["final_state"]["units"]["buffer"]["hp"], 13)
        self.assertEqual(result["final_state"]["units"]["buffer"]["temp_hp"], 0)


if __name__ == "__main__":
    unittest.main()
