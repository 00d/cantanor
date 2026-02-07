from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from engine.io.content_pack_loader import (
    ContentPackValidationError,
    content_pack_supports_phase,
    load_content_pack,
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


if __name__ == "__main__":
    unittest.main()
