from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5PersistentRecovery(unittest.TestCase):
    def test_persistent_damage_recovery_expires_effect(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_persistent_recovery_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_tick", event_types)
        self.assertIn("effect_expire", event_types)
        self.assertNotIn("command_error", event_types)

        tick = [e for e in result["events"] if e["type"] == "effect_tick"][-1]
        self.assertEqual(tick["payload"].get("kind"), "persistent_damage")
        self.assertTrue(tick["payload"]["recovery"]["recovered"])


if __name__ == "__main__":
    unittest.main()
