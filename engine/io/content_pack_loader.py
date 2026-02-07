"""Versioned content-pack loader, validation, and scenario integration helpers."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable


_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


class ContentPackValidationError(ValueError):
    pass


class ContentPackResolutionError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContentPackValidationError(message)


def _require_resolution(condition: bool, message: str) -> None:
    if not condition:
        raise ContentPackResolutionError(message)


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


def build_content_entry_lookup(packs: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Build an entry lookup map with duplicate-id protection across packs."""

    lookup: Dict[str, Dict[str, Any]] = {}
    for pack in packs:
        pack_id = str(pack["pack_id"])
        for entry in list(pack.get("entries", [])):
            entry_id = str(entry.get("id") or "")
            _require_resolution(entry_id != "", f"entry missing id in pack: {pack_id}")
            _require_resolution(entry_id not in lookup, f"duplicate entry id across packs: {entry_id}")
            lookup[entry_id] = {
                "pack_id": pack_id,
                "kind": str(entry.get("kind") or ""),
                "source_ref": entry.get("source_ref"),
                "tags": list(entry.get("tags", [])),
                "payload": copy.deepcopy(dict(entry.get("payload", {}))),
            }
    return {entry_id: lookup[entry_id] for entry_id in sorted(lookup.keys())}


def resolve_scenario_content_context(
    scenario: Dict[str, Any],
    *,
    scenario_path: Path,
    engine_phase: int,
) -> Dict[str, Any]:
    """Resolve scenario-declared content packs and verify compatibility gates."""

    raw_pack_paths = list(scenario.get("content_packs", []))
    if not raw_pack_paths:
        return {
            "selected_pack_id": None,
            "packs": [],
            "entry_lookup": {},
        }

    loaded_packs: Dict[str, Dict[str, Any]] = {}
    for raw_path in raw_pack_paths:
        pack_path = Path(str(raw_path))
        if not pack_path.is_absolute():
            scenario_relative = (scenario_path.parent / pack_path).resolve()
            cwd_relative = pack_path.resolve()
            pack_path = scenario_relative if scenario_relative.exists() else cwd_relative
        _require_resolution(pack_path.exists(), f"content pack path not found: {raw_path}")
        pack = load_content_pack(pack_path)
        pack_id = str(pack["pack_id"])
        _require_resolution(
            content_pack_supports_phase(pack, engine_phase),
            f"content pack {pack_id} incompatible with engine phase {engine_phase}",
        )
        _require_resolution(pack_id not in loaded_packs, f"duplicate content pack id: {pack_id}")
        loaded_packs[pack_id] = pack

    selected_pack_id = scenario.get("content_pack_id")
    if selected_pack_id is None and len(loaded_packs) == 1:
        selected_pack_id = next(iter(loaded_packs.keys()))
    if selected_pack_id is not None:
        selected_pack_id = str(selected_pack_id)
        _require_resolution(selected_pack_id in loaded_packs, f"scenario content_pack_id not loaded: {selected_pack_id}")

    required_features = list(scenario.get("required_content_features", []))
    if required_features:
        _require_resolution(
            selected_pack_id is not None,
            "required_content_features requires content_pack_id or exactly one loaded content pack",
        )
        selected = loaded_packs[str(selected_pack_id)]
        feature_tags = {str(x) for x in list(dict(selected.get("compatibility", {})).get("feature_tags", []))}
        missing = [tag for tag in required_features if str(tag) not in feature_tags]
        _require_resolution(
            not missing,
            f"content pack {selected_pack_id} missing required feature tags: {missing}",
        )

    packs_sorted = [loaded_packs[pack_id] for pack_id in sorted(loaded_packs.keys())]
    entry_lookup = build_content_entry_lookup(packs_sorted)

    pack_metadata = []
    for pack in packs_sorted:
        compatibility = dict(pack.get("compatibility", {}))
        pack_metadata.append(
            {
                "pack_id": str(pack["pack_id"]),
                "version": str(pack["version"]),
                "entry_count": len(list(pack.get("entries", []))),
                "compatibility": {
                    "min_engine_phase": int(compatibility.get("min_engine_phase", 0)),
                    "max_engine_phase": int(compatibility.get("max_engine_phase", -1)),
                    "feature_tags": sorted(str(tag) for tag in list(compatibility.get("feature_tags", []))),
                },
            }
        )

    return {
        "selected_pack_id": selected_pack_id,
        "packs": pack_metadata,
        "entry_lookup": entry_lookup,
    }
