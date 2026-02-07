from __future__ import annotations

import unittest
from pathlib import Path

from engine.io.command_authoring import (
    CommandAuthoringError,
    build_command_authoring_catalog,
    build_ui_command_intent,
    list_content_entry_options,
)
from engine.io.content_pack_loader import resolve_scenario_content_context


def _phase8_context() -> dict:
    scenario = {
        "content_packs": ["corpus/content_packs/phase7_baseline_v1.json"],
        "content_pack_id": "phase7-baseline-v1",
    }
    return resolve_scenario_content_context(
        scenario,
        scenario_path=Path("scenarios/smoke/phase8_pack_cast_spell_basic.json"),
        engine_phase=8,
    )


class TestCommandAuthoring(unittest.TestCase):
    def test_list_content_entry_options_filters_template_entries(self) -> None:
        context = _phase8_context()
        options = list_content_entry_options(context)
        option_ids = [o["entry_id"] for o in options]

        self.assertIn("spell.arc_flash", option_ids)
        self.assertIn("feat.quick_patch", option_ids)
        self.assertIn("item.battle_tonic", option_ids)

    def test_build_cast_spell_intent(self) -> None:
        context = _phase8_context()
        intent = build_ui_command_intent(
            context,
            actor="enemy_caster",
            command_type="cast_spell",
            content_entry_id="spell.arc_flash",
            target="pc_target",
            dc=22,
        )

        self.assertEqual(intent["source_pack_id"], "phase7-baseline-v1")
        self.assertEqual(intent["command"]["type"], "cast_spell")
        self.assertEqual(intent["command"]["actor"], "enemy_caster")
        self.assertEqual(intent["command"]["content_entry_id"], "spell.arc_flash")
        self.assertEqual(intent["command"]["target"], "pc_target")
        self.assertEqual(intent["command"]["dc"], 22)

    def test_build_use_feat_intent_defaults_target_to_actor(self) -> None:
        context = _phase8_context()
        intent = build_ui_command_intent(
            context,
            actor="bard",
            command_type="use_feat",
            content_entry_id="feat.quick_patch",
        )

        self.assertEqual(intent["command"]["target"], "bard")

    def test_rejects_command_type_mismatch(self) -> None:
        context = _phase8_context()
        with self.assertRaises(CommandAuthoringError):
            build_ui_command_intent(
                context,
                actor="caster",
                command_type="cast_spell",
                content_entry_id="feat.quick_patch",
                target="pc",
                dc=20,
            )

    def test_build_command_authoring_catalog(self) -> None:
        context = _phase8_context()
        catalog = build_command_authoring_catalog(context)

        self.assertIn("cast_spell", catalog["template_command_types"])
        self.assertGreaterEqual(len(catalog["options"]), 3)


if __name__ == "__main__":
    unittest.main()
