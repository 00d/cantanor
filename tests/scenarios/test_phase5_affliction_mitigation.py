from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase5AfflictionMitigation(unittest.TestCase):
    def test_affliction_stage_damage_respects_mitigation(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase5_affliction_mitigation_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        apply_event = [e for e in result["events"] if e["type"] == "effect_apply"][-1]
        stage_damage = apply_event["payload"]["stage_result"]["damage"][0]
        self.assertEqual(stage_damage["damage_type"], "poison")
        self.assertEqual(stage_damage["raw_total"], 10)
        self.assertEqual(stage_damage["resistance_total"], 4)
        self.assertEqual(stage_damage["weakness_total"], 1)
        self.assertEqual(stage_damage["total"], 7)
        self.assertEqual(result["final_state"]["units"]["target"]["hp"], 13)


if __name__ == "__main__":
    unittest.main()
