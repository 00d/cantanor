from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase8ContentEntryTemplates(unittest.TestCase):
    def test_cast_spell_materializes_from_content_entry(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase8_pack_cast_spell_basic.json"))

        self.assertEqual(result["engine_phase"], 8)
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("cast_spell", event_types)
        self.assertNotIn("command_error", event_types)

        cast_event = [e for e in result["events"] if e["type"] == "cast_spell"][-1]["payload"]
        self.assertEqual(cast_event["spell_id"], "arc_flash")
        self.assertEqual(cast_event["save_type"], "Reflex")
        self.assertEqual(cast_event["mode"], "basic")
        self.assertEqual(cast_event["damage"]["formula"], "2d6")
        self.assertEqual(cast_event["damage"]["damage_type"], "electricity")

    def test_use_feat_materializes_from_content_entry(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase8_pack_use_feat_basic.json"))

        event_types = [e["type"] for e in result["events"]]
        self.assertIn("use_feat", event_types)
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        feat_event = [e for e in result["events"] if e["type"] == "use_feat"][-1]["payload"]
        self.assertEqual(feat_event["feat_id"], "quick_patch")

        apply_event = [e for e in result["events"] if e["type"] == "effect_apply"][-1]["payload"]
        self.assertEqual(apply_event["kind"], "temp_hp")
        self.assertEqual(apply_event["temp_hp_after"], 3)
        self.assertEqual(result["final_state"]["units"]["ally"]["temp_hp"], 3)

    def test_content_entry_mismatch_reports_command_error(self) -> None:
        scenario = {
            "battle_id": "phase8_pack_mismatch_error",
            "seed": 8803,
            "engine_phase": 8,
            "content_packs": [str(Path("corpus/content_packs/phase7_baseline_v1.json").resolve())],
            "content_pack_id": "phase7-baseline-v1",
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 24,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 7,
                    "ac": 16,
                    "damage": "1d6+3",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 24,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 15,
                    "damage": "1d6+2",
                },
            ],
            "commands": [
                {
                    "type": "cast_spell",
                    "actor": "caster",
                    "content_entry_id": "feat.quick_patch",
                    "target": "target",
                    "dc": 20,
                }
            ],
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            path = Path(tmp.name)
            json.dump(scenario, tmp)
        try:
            result = run_scenario_file(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(result["stop_reason"], "command_error")
        error_events = [e for e in result["events"] if e["type"] == "command_error"]
        self.assertTrue(error_events)
        self.assertIn("command_type mismatch", error_events[-1]["payload"]["error"])


if __name__ == "__main__":
    unittest.main()
