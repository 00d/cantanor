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

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]] as const;

interface DijkstraResult {
  /** Minimum cost to reach each visited tile, keyed by "x,y". */
  dist: Map<string, number>;
  /** Parent tile for each visited tile, for path reconstruction. */
  prev: Map<string, string>;
}

/**
 * Core Dijkstra search from `(sx, sy)` out to `maxCost` steps.
 * Bucket-queue implementation — O(V+E) since per-tile cost is a small integer.
 * Blocked and occupied tiles are walls (the moving unit's own tile is open).
 */
function dijkstra(
  state: BattleState,
  sx: number,
  sy: number,
  movingUnitId: string,
  maxCost: number,
): DijkstraResult {
  const { width, height } = state.battleMap;
  const blockedSet = new Set(state.battleMap.blocked.map(([bx, by]) => `${bx},${by}`));
  const occupiedSet = new Set(
    Object.values(state.units)
      .filter((u) => u.unitId !== movingUnitId && u.hp > 0)
      .map((u) => `${u.x},${u.y}`),
  );

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  // Bucket queue: buckets[c] = tiles reachable with exactly cost c
  const buckets: Array<Array<[number, number]>> = Array.from({ length: maxCost + 1 }, () => []);
  buckets[0].push([sx, sy]);
  dist.set(`${sx},${sy}`, 0);

  for (let c = 0; c <= maxCost; c++) {
    for (const [x, y] of buckets[c]) {
      const key = `${x},${y}`;
      if (dist.get(key) !== c) continue; // stale entry (found cheaper path)

      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nkey = `${nx},${ny}`;
        if (blockedSet.has(nkey) || occupiedSet.has(nkey)) continue;
        const tileCost = state.battleMap.moveCost?.[nkey] ?? 1;
        const nc = c + tileCost;
        if (nc > maxCost) continue;
        const known = dist.get(nkey);
        if (known !== undefined && known <= nc) continue;
        dist.set(nkey, nc);
        prev.set(nkey, key);
        buckets[nc].push([nx, ny]);
      }
    }
  }

  return { dist, prev };
}

/**
 * Returns the set of tile keys ("x,y") reachable by `unitId` within its
 * movement speed.  Blocked and occupied tiles are walls; diagonal moves are
 * not allowed.  The unit's own starting tile is excluded from the result.
 * Per-tile moveCost (default 1) is read from MapState.moveCost.
 */
export function reachableTiles(state: BattleState, unitId: string): Set<string> {
  const unit = state.units[unitId];
  if (!unit) return new Set();
  const speed = unit.speed ?? 5;
  const { dist } = dijkstra(state, unit.x, unit.y, unitId, speed);
  const result = new Set<string>();
  const startKey = `${unit.x},${unit.y}`;
  for (const key of dist.keys()) {
    if (key !== startKey) result.add(key);
  }
  return result;
}

/**
 * Finds the reachable tile that gets `unitId` closest to `(targetX, targetY)`.
 * Used by the AI to approach enemies when out of melee range.  Returns null
 * if the unit cannot move (no reachable tiles or already adjacent).
 * Ties broken by lowest movement cost, then by tile key for determinism.
 */
export function stepToward(
  state: BattleState,
  unitId: string,
  targetX: number,
  targetY: number,
): [number, number] | null {
  const unit = state.units[unitId];
  if (!unit) return null;
  const speed = unit.speed ?? 5;
  const { dist } = dijkstra(state, unit.x, unit.y, unitId, speed);

  let best: [number, number] | null = null;
  let bestDist = manhattanDistance(unit.x, unit.y, targetX, targetY);
  let bestCost = Infinity;
  let bestKey = "";

  for (const [key, cost] of dist) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (x === unit.x && y === unit.y) continue;
    const d = manhattanDistance(x, y, targetX, targetY);
    if (
      d < bestDist ||
      (d === bestDist && cost < bestCost) ||
      (d === bestDist && cost === bestCost && key < bestKey)
    ) {
      best = [x, y];
      bestDist = d;
      bestCost = cost;
      bestKey = key;
    }
  }

  return best;
}
