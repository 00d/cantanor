from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase7ContentPackIntegration(unittest.TestCase):
    def test_content_pack_context_exposed_and_resolved(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase7_content_pack_integration_basic.json"))

        event_types = [e["type"] for e in result["events"]]
        self.assertIn("content_pack_resolved", event_types)
        self.assertNotIn("command_error", event_types)

        pack_event = [e for e in result["events"] if e["type"] == "content_pack_resolved"][-1]["payload"]
        self.assertEqual(pack_event["engine_phase"], 7)
        self.assertEqual(pack_event["selected_pack_id"], "phase7-baseline-v1")
        self.assertGreaterEqual(pack_event["entry_count"], 3)

        context = dict(result["content_pack_context"])
        self.assertEqual(context["selected_pack_id"], "phase7-baseline-v1")
        self.assertEqual(len(context["packs"]), 1)
        self.assertIn("spell.arc_flash", context["entry_lookup"])
        self.assertEqual(context["entry_lookup"]["spell.arc_flash"]["kind"], "spell")


if __name__ == "__main__":
    unittest.main()
