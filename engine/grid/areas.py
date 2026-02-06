"""Area targeting helpers."""

from __future__ import annotations

import math
from typing import Iterable, List, Tuple


def radius_points(cx: int, cy: int, radius: int) -> List[Tuple[int, int]]:
    points: List[Tuple[int, int]] = []
    for x in range(cx - radius, cx + radius + 1):
        for y in range(cy - radius, cy + radius + 1):
            if abs(x - cx) + abs(y - cy) <= radius:
                points.append((x, y))
    return points


def line_points(x0: int, y0: int, x1: int, y1: int) -> List[Tuple[int, int]]:
    # Simple Bresenham implementation.
    points: List[Tuple[int, int]] = []
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x, y = x0, y0
    while True:
        points.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
    return points


def cone_points(
    origin_x: int,
    origin_y: int,
    facing_x: int,
    facing_y: int,
    length_tiles: int,
) -> List[Tuple[int, int]]:
    """Return points in a 90-degree cone from origin toward facing point."""
    length = max(1, length_tiles)
    dir_x = facing_x - origin_x
    dir_y = facing_y - origin_y
    if dir_x == 0 and dir_y == 0:
        return [(origin_x, origin_y)]

    norm = math.hypot(dir_x, dir_y)
    unit_x = dir_x / norm
    unit_y = dir_y / norm
    min_dot = math.cos(math.radians(45.0))

    points: List[Tuple[int, int]] = []
    for x in range(origin_x - length, origin_x + length + 1):
        for y in range(origin_y - length, origin_y + length + 1):
            vec_x = x - origin_x
            vec_y = y - origin_y
            dist = math.hypot(vec_x, vec_y)
            if dist == 0:
                points.append((x, y))
                continue
            if dist > length:
                continue
            dot = (vec_x * unit_x + vec_y * unit_y) / dist
            if dot >= min_dot:
                points.append((x, y))
    return points


def in_area(point: Tuple[int, int], area: Iterable[Tuple[int, int]]) -> bool:
    return point in set(area)
