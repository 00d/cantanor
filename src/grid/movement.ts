/**
 * Movement checks for square grids.
 * Mirrors engine/grid/movement.py
 */

import { BattleState, UnitState } from "../engine/state";
import { inBounds, isBlocked, isOccupied } from "./map";

export function manhattanDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function canStepTo(
  state: BattleState,
  unit: UnitState,
  x: number,
  y: number,
): boolean {
  if (!inBounds(state, x, y)) return false;
  if (isBlocked(state, x, y)) return false;
  if (isOccupied(state, x, y)) return false;
  return manhattanDistance(unit.x, unit.y, x, y) === 1;
}

/**
 * BFS — returns the set of tile keys ("x,y") reachable by `unitId` within
 * its movement speed.  Blocked and occupied tiles are walls; diagonal moves
 * are not allowed.  The unit's own starting tile is excluded from the result.
 */
export function reachableTiles(state: BattleState, unitId: string): Set<string> {
  const unit = state.units[unitId];
  if (!unit) return new Set();
  const speed = unit.speed ?? 5;

  const blockedSet = new Set(state.battleMap.blocked.map(([bx, by]) => `${bx},${by}`));
  const occupiedSet = new Set(
    Object.values(state.units)
      .filter((u) => u.unitId !== unitId && u.hp > 0)
      .map((u) => `${u.x},${u.y}`),
  );

  // BFS: track minimum cost to reach each tile
  const visited = new Map<string, number>();
  const queue: Array<{ x: number; y: number; cost: number }> = [
    { x: unit.x, y: unit.y, cost: 0 },
  ];
  const reachable = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue;
    visited.set(key, current.cost);

    if (current.x !== unit.x || current.y !== unit.y) {
      reachable.add(key);
    }

    if (current.cost >= speed) continue;

    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nkey = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= state.battleMap.width || ny >= state.battleMap.height) continue;
      if (blockedSet.has(nkey)) continue;
      if (occupiedSet.has(nkey)) continue;
      if (visited.has(nkey)) continue;
      queue.push({ x: nx, y: ny, cost: current.cost + 1 });
    }
  }

  return reachable;
}
