"""Turn order helpers."""

from __future__ import annotations

from typing import Dict, List

from engine.core.state import UnitState


def build_turn_order(units: Dict[str, UnitState]) -> List[str]:
    # Higher initiative acts first; ties break by stable unit id.
    ordered = sorted(units.values(), key=lambda u: (-u.initiative, u.unit_id))
    return [u.unit_id for u in ordered]


def next_turn_index(current: int, turn_order_size: int) -> int:
    return (current + 1) % turn_order_size
