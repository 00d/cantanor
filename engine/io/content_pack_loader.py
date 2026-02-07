"""Versioned content-pack loader and validation helpers."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict


_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


class ContentPackValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContentPackValidationError(message)


def validate_content_pack(data: Dict[str, Any]) -> None:
    _require(isinstance(data, dict), "content pack must be object")

    for key in ("pack_id", "version", "compatibility", "entries"):
        _require(key in data, f"content pack missing key: {key}")

    pack_id = data["pack_id"]
    _require(isinstance(pack_id, str) and bool(pack_id), "pack_id must be non-empty string")

    version = data["version"]
    _require(isinstance(version, str) and bool(_SEMVER_RE.match(version)), "version must be semver string MAJOR.MINOR.PATCH")

    compatibility = data["compatibility"]
    _require(isinstance(compatibility, dict), "compatibility must be object")
    min_phase = compatibility.get("min_engine_phase")
    max_phase = compatibility.get("max_engine_phase")
    _require(isinstance(min_phase, int) and min_phase > 0, "compatibility.min_engine_phase must be positive int")
    _require(isinstance(max_phase, int) and max_phase > 0, "compatibility.max_engine_phase must be positive int")
    _require(min_phase <= max_phase, "compatibility min_engine_phase cannot exceed max_engine_phase")
    feature_tags = compatibility.get("feature_tags", [])
    _require(isinstance(feature_tags, list), "compatibility.feature_tags must be list")
    for idx, tag in enumerate(feature_tags):
        _require(isinstance(tag, str) and bool(tag), f"compatibility.feature_tags[{idx}] must be non-empty string")

    entries = data["entries"]
    _require(isinstance(entries, list) and entries, "entries must be non-empty list")
    seen_ids: set[str] = set()
    allowed_kinds = {"action", "spell", "feat", "item", "trait", "condition"}
    for idx, entry in enumerate(entries):
        context = f"entries[{idx}]"
        _require(isinstance(entry, dict), f"{context} must be object")
        for key in ("id", "kind", "payload"):
            _require(key in entry, f"{context} missing key: {key}")

        entry_id = entry["id"]
        _require(isinstance(entry_id, str) and bool(entry_id), f"{context}.id must be non-empty string")
        _require(entry_id not in seen_ids, f"duplicate entry id: {entry_id}")
        seen_ids.add(entry_id)

        kind = entry["kind"]
        _require(isinstance(kind, str) and kind in allowed_kinds, f"{context}.kind invalid: {kind}")

        source = entry.get("source_ref")
        if source is not None:
            _require(isinstance(source, str) and bool(source), f"{context}.source_ref must be non-empty string when present")

        tags = entry.get("tags", [])
        _require(isinstance(tags, list), f"{context}.tags must be list when present")
        for tag_idx, tag in enumerate(tags):
            _require(isinstance(tag, str) and bool(tag), f"{context}.tags[{tag_idx}] must be non-empty string")

        payload = entry["payload"]
        _require(isinstance(payload, dict), f"{context}.payload must be object")


def load_content_pack(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_content_pack(data)
    return data


def content_pack_supports_phase(pack: Dict[str, Any], phase: int) -> bool:
    compatibility = dict(pack.get("compatibility", {}))
    min_phase = int(compatibility.get("min_engine_phase", 0))
    max_phase = int(compatibility.get("max_engine_phase", -1))
    return min_phase <= int(phase) <= max_phase
