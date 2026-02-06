"""Grid map helpers."""

from __future__ import annotations

from engine.core.state import BattleState


def in_bounds(state: BattleState, x: int, y: int) -> bool:
    return 0 <= x < state.battle_map.width and 0 <= y < state.battle_map.height


def is_blocked(state: BattleState, x: int, y: int) -> bool:
    return (x, y) in set(state.battle_map.blocked)


def is_occupied(state: BattleState, x: int, y: int) -> bool:
    for unit in state.units.values():
        if unit.alive and unit.x == x and unit.y == y:
            return True
    return False
