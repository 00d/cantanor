from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5ConditionImmunity(unittest.TestCase):
    def test_condition_effect_is_skipped_for_immune_target(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_condition_immunity_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_apply", event_types)
        self.assertIn("effect_expire", event_types)
        self.assertNotIn("command_error", event_types)

        effect_apply = [e for e in result["events"] if e["type"] == "effect_apply"][0]
        payload = effect_apply["payload"]
        self.assertEqual(payload["condition"], "frightened")
        self.assertFalse(payload["applied"])
        self.assertEqual(payload["reason"], "condition_immune")
        self.assertNotIn("frightened", result["final_state"]["units"]["target"]["conditions"])


if __name__ == "__main__":
    unittest.main()
