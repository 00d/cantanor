"""Condition mutation helpers."""

from __future__ import annotations

from typing import Dict, Iterable


def normalize_condition_name(name: str) -> str:
    return name.lower().replace(" ", "_")


def condition_is_immune(name: str, condition_immunities: Iterable[str]) -> bool:
    normalized = normalize_condition_name(name)
    immunity_set = {normalize_condition_name(x) for x in condition_immunities}
    return normalized in immunity_set or "all_conditions" in immunity_set


def apply_condition(conditions: Dict[str, int], name: str, value: int = 1) -> Dict[str, int]:
    result = dict(conditions)
    key = normalize_condition_name(name)
    current = result.get(key, 0)
    result[key] = max(current, value)
    return result


def clear_condition(conditions: Dict[str, int], name: str) -> Dict[str, int]:
    result = dict(conditions)
    key = normalize_condition_name(name)
    result.pop(key, None)
    return result
