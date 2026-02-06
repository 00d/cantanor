"""Line of sight helpers."""

from __future__ import annotations

from engine.core.state import BattleState, UnitState
from engine.grid.loe import has_line_of_effect


def has_line_of_sight(state: BattleState, source: UnitState, target: UnitState) -> bool:
    return has_line_of_effect(state, source, target)
