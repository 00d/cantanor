from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from engine.io.content_pack_loader import (
    ContentPackResolutionError,
    ContentPackValidationError,
    content_pack_supports_phase,
    load_content_pack,
    resolve_scenario_content_context,
    validate_content_pack,
)


def _valid_pack() -> dict:
    return {
        "pack_id": "phase7-test-pack",
        "version": "1.0.0",
        "compatibility": {
            "min_engine_phase": 7,
            "max_engine_phase": 8,
            "feature_tags": ["test"],
        },
        "entries": [
            {
                "id": "spell.arc_flash",
                "kind": "spell",
                "payload": {"command_type": "cast_spell"},
            }
        ],
    }


class TestContentPackLoader(unittest.TestCase):
    def test_validate_content_pack_accepts_valid_shape(self) -> None:
        validate_content_pack(_valid_pack())

    def test_validate_content_pack_rejects_duplicate_entry_ids(self) -> None:
        pack = _valid_pack()
        pack["entries"].append(
            {
                "id": "spell.arc_flash",
                "kind": "spell",
                "payload": {"command_type": "cast_spell"},
            }
        )
        with self.assertRaises(ContentPackValidationError):
            validate_content_pack(pack)

    def test_validate_content_pack_rejects_invalid_semver(self) -> None:
        pack = _valid_pack()
        pack["version"] = "v1"
        with self.assertRaises(ContentPackValidationError):
            validate_content_pack(pack)

    def test_validate_content_pack_rejects_bad_phase_bounds(self) -> None:
        pack = _valid_pack()
        pack["compatibility"]["min_engine_phase"] = 9
        pack["compatibility"]["max_engine_phase"] = 7
        with self.assertRaises(ContentPackValidationError):
            validate_content_pack(pack)

    def test_content_pack_supports_phase(self) -> None:
        pack = _valid_pack()
        self.assertTrue(content_pack_supports_phase(pack, 7))
        self.assertTrue(content_pack_supports_phase(pack, 8))
        self.assertFalse(content_pack_supports_phase(pack, 6))
        self.assertFalse(content_pack_supports_phase(pack, 9))

    def test_load_content_pack_reads_and_validates_json(self) -> None:
        pack = _valid_pack()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(pack, tmp)
            path = Path(tmp.name)
        try:
            loaded = load_content_pack(path)
            self.assertEqual(loaded["pack_id"], "phase7-test-pack")
            self.assertEqual(len(loaded["entries"]), 1)
        finally:
            path.unlink(missing_ok=True)

    def test_resolve_scenario_content_context_loads_lookup(self) -> None:
        pack = _valid_pack()
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            pack_path = root / "pack.json"
            scenario_path = root / "scenario.json"
            pack_path.write_text(json.dumps(pack), encoding="utf-8")
            scenario_path.write_text("{}", encoding="utf-8")
            context = resolve_scenario_content_context(
                {
                    "content_packs": ["pack.json"],
                    "content_pack_id": "phase7-test-pack",
                    "required_content_features": ["test"],
                },
                scenario_path=scenario_path,
                engine_phase=7,
            )
            self.assertEqual(context["selected_pack_id"], "phase7-test-pack")
            self.assertEqual(len(context["packs"]), 1)
            self.assertIn("spell.arc_flash", context["entry_lookup"])

    def test_resolve_scenario_content_context_rejects_incompatible_phase(self) -> None:
        pack = _valid_pack()
        pack["compatibility"]["min_engine_phase"] = 8
        pack["compatibility"]["max_engine_phase"] = 9
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            pack_path = root / "pack.json"
            scenario_path = root / "scenario.json"
            pack_path.write_text(json.dumps(pack), encoding="utf-8")
            scenario_path.write_text("{}", encoding="utf-8")
            with self.assertRaises(ContentPackResolutionError):
                resolve_scenario_content_context(
                    {"content_packs": ["pack.json"]},
                    scenario_path=scenario_path,
                    engine_phase=7,
                )


if __name__ == "__main__":
    unittest.main()
