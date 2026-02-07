"""Browser-facing command-authoring helpers for content-entry driven commands."""

from __future__ import annotations

from typing import Any, Dict, List


TEMPLATE_COMMAND_TYPES = ("cast_spell", "use_feat", "use_item", "interact")


class CommandAuthoringError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CommandAuthoringError(message)


def _entry_payload(content_context: Dict[str, Any], content_entry_id: str) -> Dict[str, Any]:
    lookup = dict(content_context.get("entry_lookup", {}))
    entry = lookup.get(content_entry_id)
    _require(entry is not None, f"unknown content entry {content_entry_id}")
    payload = dict(entry.get("payload", {}))
    return payload


def list_content_entry_options(content_context: Dict[str, Any], *, command_type: str | None = None) -> List[Dict[str, Any]]:
    """List deterministic UI option records for template-capable entries."""

    if command_type is not None:
        _require(command_type in TEMPLATE_COMMAND_TYPES, f"unsupported command_type filter: {command_type}")

    lookup = dict(content_context.get("entry_lookup", {}))
    out: List[Dict[str, Any]] = []
    for entry_id in sorted(lookup.keys()):
        entry = dict(lookup[entry_id])
        payload = dict(entry.get("payload", {}))
        template_type = str(payload.get("command_type") or "")
        if template_type not in TEMPLATE_COMMAND_TYPES:
            continue
        if command_type is not None and template_type != command_type:
            continue
        out.append(
            {
                "entry_id": entry_id,
                "command_type": template_type,
                "kind": str(entry.get("kind") or ""),
                "pack_id": str(entry.get("pack_id") or ""),
                "source_ref": entry.get("source_ref"),
                "tags": list(entry.get("tags", [])),
            }
        )
    return out


def build_ui_command_intent(
    content_context: Dict[str, Any],
    *,
    actor: str,
    command_type: str,
    content_entry_id: str,
    target: str | None = None,
    dc: int | None = None,
    overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Build a validated command intent that UI clients can submit directly."""

    _require(isinstance(actor, str) and bool(actor), "actor must be non-empty string")
    _require(command_type in TEMPLATE_COMMAND_TYPES, f"unsupported command_type: {command_type}")
    _require(isinstance(content_entry_id, str) and bool(content_entry_id), "content_entry_id must be non-empty string")

    payload = _entry_payload(content_context, content_entry_id)
    template_type = str(payload.get("command_type") or "")
    _require(template_type == command_type, f"command_type mismatch: {template_type} != {command_type}")

    command: Dict[str, Any] = {
        "type": command_type,
        "actor": actor,
        "content_entry_id": content_entry_id,
    }

    if command_type == "cast_spell":
        _require(isinstance(target, str) and bool(target), "cast_spell intent requires target")
        _require(isinstance(dc, int) and dc > 0, "cast_spell intent requires positive dc")
        command["target"] = target
        command["dc"] = int(dc)
    elif command_type in ("use_feat", "use_item"):
        command["target"] = str(target or actor)
    elif command_type == "interact":
        command["target"] = str(target or actor)

    if overrides is not None:
        _require(isinstance(overrides, dict), "overrides must be object when present")
        if "type" in overrides:
            _require(str(overrides["type"]) == command_type, "overrides.type cannot change command type")
        if "actor" in overrides:
            _require(str(overrides["actor"]) == actor, "overrides.actor cannot change actor")
        command.update(dict(overrides))

    if command_type == "cast_spell":
        _require(isinstance(command.get("target"), str) and bool(command["target"]), "cast_spell target must be non-empty string")
        _require(isinstance(command.get("dc"), int) and int(command["dc"]) > 0, "cast_spell dc must be positive int")
    elif command_type in ("use_feat", "use_item"):
        _require(isinstance(command.get("target"), str) and bool(command["target"]), f"{command_type} target must be non-empty string")

    entry = dict(dict(content_context.get("entry_lookup", {}))[content_entry_id])
    return {
        "actor": actor,
        "command_type": command_type,
        "content_entry_id": content_entry_id,
        "source_pack_id": str(entry.get("pack_id") or ""),
        "command": command,
    }


def build_command_authoring_catalog(content_context: Dict[str, Any]) -> Dict[str, Any]:
    """Build a stable catalog for browser command builders."""

    return {
        "template_command_types": list(TEMPLATE_COMMAND_TYPES),
        "options": list_content_entry_options(content_context),
    }
