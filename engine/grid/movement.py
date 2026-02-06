"""Movement checks for square grids."""

from __future__ import annotations

from engine.core.state import BattleState, UnitState
from engine.grid.map import in_bounds, is_blocked, is_occupied


def manhattan_distance(ax: int, ay: int, bx: int, by: int) -> int:
    return abs(ax - bx) + abs(ay - by)


def can_step_to(state: BattleState, unit: UnitState, x: int, y: int) -> bool:
    if not in_bounds(state, x, y):
        return False
    if is_blocked(state, x, y):
        return False
    if is_occupied(state, x, y):
        return False
    return manhattan_distance(unit.x, unit.y, x, y) == 1
