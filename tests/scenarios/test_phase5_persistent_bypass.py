from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5PersistentBypass(unittest.TestCase):
    def test_persistent_damage_bypass_ignores_matching_immunity(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_persistent_bypass_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_tick", event_types)
        self.assertNotIn("command_error", event_types)

        tick_event = [e for e in result["events"] if e["type"] == "effect_tick"][-1]
        damage = tick_event["payload"]["damage"]
        self.assertEqual(damage["damage_type"], "fire")
        self.assertEqual(damage["bypass"], ["fire"])
        self.assertFalse(damage["immune"])
        self.assertEqual(damage["total"], 2)
        self.assertEqual(result["final_state"]["units"]["target"]["hp"], 18)


if __name__ == "__main__":
    unittest.main()
