from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase7InteractCommand(unittest.TestCase):
    def test_interact_applies_effect_and_flag_update(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase7_interact_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("interact", event_types)
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        interact = [e for e in result["events"] if e["type"] == "interact"][-1]["payload"]
        self.assertEqual(interact["interact_id"], "console_override")
        self.assertEqual(interact["action_cost"], 1)
        self.assertEqual(interact["actions_remaining"], 2)
        self.assertEqual(interact["flag_update"]["flag"], "console_unlocked")
        self.assertTrue(interact["flag_update"]["value"])

        effect_apply = [e for e in result["events"] if e["type"] == "effect_apply"][-1]["payload"]
        self.assertEqual(effect_apply["kind"], "temp_hp")
        self.assertEqual(effect_apply["temp_hp_after"], 3)
        self.assertEqual(result["final_state"]["flags"].get("console_unlocked"), True)


if __name__ == "__main__":
    unittest.main()
