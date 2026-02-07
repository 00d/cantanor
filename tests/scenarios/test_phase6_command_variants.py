from __future__ import annotations

import unittest
from pathlib import Path

from engine.cli.run_scenario import run_scenario_file


class TestPhase6CommandVariants(unittest.TestCase):
    def test_cast_spell_resolves_basic_save_damage(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase6_cast_spell_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("cast_spell", event_types)
        self.assertNotIn("command_error", event_types)

        cast_event = [e for e in result["events"] if e["type"] == "cast_spell"][-1]["payload"]
        self.assertEqual(cast_event["spell_id"], "ember_burst")
        self.assertEqual(cast_event["action_cost"], 2)
        self.assertEqual(cast_event["actions_remaining"], 1)
        self.assertEqual(cast_event["damage"]["damage_type"], "fire")
        self.assertEqual(result["final_state"]["units"]["raider"]["hp"], 40 - cast_event["damage"]["applied_total"])

    def test_use_feat_applies_effect_lifecycle(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase6_use_feat_effect_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("use_feat", event_types)
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        feat_event = [e for e in result["events"] if e["type"] == "use_feat"][-1]["payload"]
        self.assertEqual(feat_event["feat_id"], "inspiring_chorus")
        self.assertEqual(feat_event["action_cost"], 1)
        self.assertEqual(feat_event["actions_remaining"], 2)

        apply_event = [e for e in result["events"] if e["type"] == "effect_apply"][-1]["payload"]
        self.assertEqual(apply_event["kind"], "temp_hp")
        self.assertEqual(apply_event["temp_hp_after"], 4)
        self.assertEqual(result["final_state"]["units"]["ally"]["temp_hp"], 4)

    def test_use_item_applies_condition_effect(self) -> None:
        result = run_scenario_file(Path("scenarios/smoke/phase6_use_item_effect_basic.json"))
        event_types = [e["type"] for e in result["events"]]
        self.assertIn("use_item", event_types)
        self.assertIn("effect_apply", event_types)
        self.assertNotIn("command_error", event_types)

        item_event = [e for e in result["events"] if e["type"] == "use_item"][-1]["payload"]
        self.assertEqual(item_event["item_id"], "steady_tonic")
        self.assertEqual(item_event["action_cost"], 1)
        self.assertEqual(item_event["actions_remaining"], 2)

        apply_event = [e for e in result["events"] if e["type"] == "effect_apply"][-1]["payload"]
        self.assertEqual(apply_event["kind"], "condition")
        self.assertTrue(apply_event["applied"])
        self.assertEqual(apply_event["condition"], "frightened")
        self.assertEqual(result["final_state"]["units"]["ally"]["conditions"].get("frightened"), 1)


if __name__ == "__main__":
    unittest.main()
