"""Condition mutation helpers."""

from __future__ import annotations

from typing import Dict


def apply_condition(conditions: Dict[str, int], name: str, value: int = 1) -> Dict[str, int]:
    result = dict(conditions)
    key = name.lower().replace(" ", "_")
    current = result.get(key, 0)
    result[key] = max(current, value)
    return result


def clear_condition(conditions: Dict[str, int], name: str) -> Dict[str, int]:
    result = dict(conditions)
    key = name.lower().replace(" ", "_")
    result.pop(key, None)
    return result
