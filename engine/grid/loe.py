"""Line of effect helpers."""

from __future__ import annotations

from typing import Literal

from engine.core.state import BattleState, UnitState
from engine.grid.areas import line_points
from engine.grid.map import in_bounds, is_blocked

CoverGrade = Literal["none", "standard", "greater", "blocked"]


def _sign(value: int) -> int:
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def has_tile_line_of_effect(
    state: BattleState,
    source_x: int,
    source_y: int,
    target_x: int,
    target_y: int,
) -> bool:
    if not in_bounds(state, source_x, source_y):
        return False
    if not in_bounds(state, target_x, target_y):
        return False

    path = line_points(source_x, source_y, target_x, target_y)
    for idx, (x, y) in enumerate(path):
        if idx == 0:
            continue

        prev_x, prev_y = path[idx - 1]
        step_x = x - prev_x
        step_y = y - prev_y
        if abs(step_x) == 1 and abs(step_y) == 1:
            side_a = (prev_x + step_x, prev_y)
            side_b = (prev_x, prev_y + step_y)
            side_a_blocked = in_bounds(state, side_a[0], side_a[1]) and is_blocked(state, side_a[0], side_a[1])
            side_b_blocked = in_bounds(state, side_b[0], side_b[1]) and is_blocked(state, side_b[0], side_b[1])
            if side_a_blocked and side_b_blocked:
                return False

        if idx == len(path) - 1:
            # Allow targeting an occupied endpoint tile.
            return not is_blocked(state, x, y)
        if is_blocked(state, x, y):
            return False
    return True


def cover_grade_between_tiles(
    state: BattleState,
    source_x: int,
    source_y: int,
    target_x: int,
    target_y: int,
) -> CoverGrade:
    if not has_tile_line_of_effect(state, source_x, source_y, target_x, target_y):
        return "blocked"

    sx = _sign(source_x - target_x)
    sy = _sign(source_y - target_y)
    if sx == 0 and sy == 0:
        return "none"

    candidates: list[tuple[int, int]]
    if sx == 0:
        candidates = [(target_x - 1, target_y), (target_x + 1, target_y)]
    elif sy == 0:
        candidates = [(target_x, target_y - 1), (target_x, target_y + 1)]
    else:
        candidates = [(target_x + sx, target_y), (target_x, target_y + sy)]

    blocked_count = 0
    for x, y in candidates:
        if in_bounds(state, x, y) and is_blocked(state, x, y):
            blocked_count += 1

    if blocked_count >= 2:
        return "greater"
    if blocked_count == 1:
        return "standard"
    return "none"


def cover_ac_bonus_from_grade(grade: CoverGrade) -> int:
    if grade == "standard":
        return 2
    if grade == "greater":
        return 4
    return 0


def cover_ac_bonus_between_tiles(
    state: BattleState,
    source_x: int,
    source_y: int,
    target_x: int,
    target_y: int,
) -> int:
    return cover_ac_bonus_from_grade(
        cover_grade_between_tiles(
            state=state,
            source_x=source_x,
            source_y=source_y,
            target_x=target_x,
            target_y=target_y,
        )
    )


def has_line_of_effect(state: BattleState, source: UnitState, target: UnitState) -> bool:
    if not source.alive or not target.alive:
        return False
    return has_tile_line_of_effect(state, source.x, source.y, target.x, target.y)


def cover_grade_for_units(state: BattleState, source: UnitState, target: UnitState) -> CoverGrade:
    if not source.alive or not target.alive:
        return "blocked"
    return cover_grade_between_tiles(state, source.x, source.y, target.x, target.y)


def cover_ac_bonus_for_units(state: BattleState, source: UnitState, target: UnitState) -> int:
    if not source.alive or not target.alive:
        return 0
    return cover_ac_bonus_between_tiles(state, source.x, source.y, target.x, target.y)
