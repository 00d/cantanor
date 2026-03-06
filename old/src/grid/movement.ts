/**
 * Movement checks for square grids with 8-connected (diagonal) movement.
 * Implements PF2e alternating diagonal cost: 1st diagonal = 5ft (1 tile),
 * 2nd diagonal = 10ft (2 tiles), alternating.
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

/** Chebyshev distance — max of axis deltas. Used for reach/adjacency in PF2e. */
export function chebyshevDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Can `unit` step to adjacent tile `(x, y)` in one move?
 * Allows 8-connected adjacency (Chebyshev distance 1).
 * Diagonal steps require both "corner" tiles to be passable (not blocked, not occupied).
 */
export function canStepTo(
  state: BattleState,
  unit: UnitState,
  x: number,
  y: number,
): boolean {
  if (!inBounds(state, x, y)) return false;
  if (isBlocked(state, x, y)) return false;
  if (isOccupied(state, x, y)) return false;
  if (chebyshevDistance(unit.x, unit.y, x, y) !== 1) return false;

  // Corner-cutting prevention for diagonal moves
  const dx = x - unit.x;
  const dy = y - unit.y;
  if (dx !== 0 && dy !== 0) {
    // Diagonal — both adjacent orthogonal tiles must be passable
    if (isBlocked(state, unit.x + dx, unit.y) || isOccupied(state, unit.x + dx, unit.y)) return false;
    if (isBlocked(state, unit.x, unit.y + dy) || isOccupied(state, unit.x, unit.y + dy)) return false;
  }
  return true;
}

// 8-connected directions: orthogonal then diagonal
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1], [1, 0], [-1, 0],   // orthogonal
  [1, 1], [1, -1], [-1, 1], [-1, -1],  // diagonal
];

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
 *
 * PF2e diagonal cost: tracked via parity bit per Dijkstra state node.
 * State key is "x,y,parity". Diagonal from parity 0 costs tileCost×1 (flips to 1).
 * Diagonal from parity 1 costs tileCost×2 (flips to 0). Orthogonal doesn't change parity.
 * The returned `dist` map contains the minimum cost across both parities for each tile.
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

  // Internal distance map keyed by "x,y,parity"
  const stateDist = new Map<string, number>();
  // Best distance per tile (min across both parities)
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();

  // Bucket queue: buckets[c] = list of [x, y, parity] entries
  const maxBucket = maxCost * 4; // worst case: every step is diagonal parity-1 on difficult terrain (tileCost 2 × parity multiplier 2)
  const buckets: Array<Array<[number, number, number]>> = Array.from({ length: maxBucket + 1 }, () => []);
  buckets[0].push([sx, sy, 0]);
  stateDist.set(`${sx},${sy},0`, 0);
  dist.set(`${sx},${sy}`, 0);

  for (let c = 0; c <= maxBucket; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const [x, y, parity] = bucket[bi];
      const stateKey = `${x},${y},${parity}`;
      if (stateDist.get(stateKey) !== c) continue; // stale entry

      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nkey = `${nx},${ny}`;
        if (blockedSet.has(nkey) || occupiedSet.has(nkey)) continue;

        const isDiagonal = dx !== 0 && dy !== 0;

        // Corner-cutting prevention for diagonals
        if (isDiagonal) {
          const cx1 = `${x + dx},${y}`;
          const cx2 = `${x},${y + dy}`;
          if (blockedSet.has(cx1) || occupiedSet.has(cx1)) continue;
          if (blockedSet.has(cx2) || occupiedSet.has(cx2)) continue;
        }

        const tileCost = state.battleMap.moveCost?.[nkey] ?? 1;
        let moveCost: number;
        let nextParity: number;

        if (isDiagonal) {
          if (parity === 0) {
            // First diagonal: costs tileCost × 1
            moveCost = tileCost;
            nextParity = 1;
          } else {
            // Second diagonal: costs tileCost × 2
            moveCost = tileCost * 2;
            nextParity = 0;
          }
        } else {
          // Orthogonal: costs tileCost, parity unchanged
          moveCost = tileCost;
          nextParity = parity;
        }

        const nc = c + moveCost;
        if (nc > maxCost) continue;

        const nStateKey = `${nx},${ny},${nextParity}`;
        const knownState = stateDist.get(nStateKey);
        if (knownState !== undefined && knownState <= nc) continue;
        stateDist.set(nStateKey, nc);

        // Update best dist for this tile position
        const knownTile = dist.get(nkey);
        if (knownTile === undefined || nc < knownTile) {
          dist.set(nkey, nc);
          prev.set(nkey, `${x},${y}`);
        }

        buckets[nc].push([nx, ny, nextParity]);
      }
    }
  }

  return { dist, prev };
}

export interface ReachResult {
  /** Tile keys ("x,y") reachable within movement speed. Excludes the start tile. */
  tiles: Set<string>;
  /** Parent-pointer map — `prev.get(tile)` is the step before `tile` on the
   *  shortest path from the unit's start. The start tile has no entry, so a
   *  walk-back loop naturally terminates there. */
  prev: Map<string, string>;
}

/**
 * Run Dijkstra once from the unit's position and hand back both the reachable
 * set and the parent map. Callers that need path reconstruction hold onto
 * `prev` and feed it to `pathTo()` per hovered destination — no re-search as
 * the mouse moves.
 */
export function reachableWithPrev(state: BattleState, unitId: string): ReachResult {
  const unit = state.units[unitId];
  if (!unit) return { tiles: new Set(), prev: new Map() };
  const speed = unit.speed ?? 5;
  const { dist, prev } = dijkstra(state, unit.x, unit.y, unitId, speed);
  const tiles = new Set<string>();
  const startKey = `${unit.x},${unit.y}`;
  for (const key of dist.keys()) {
    if (key !== startKey) tiles.add(key);
  }
  return { tiles, prev };
}

/**
 * Returns the set of tile keys ("x,y") reachable by `unitId` within its
 * movement speed. Uses 8-connected movement with PF2e alternating diagonal cost.
 * Blocked and occupied tiles are walls. Corner-cutting is prevented.
 * The unit's own starting tile is excluded from the result.
 * Per-tile moveCost (default 1) is read from MapState.moveCost.
 *
 * Thin wrapper over reachableWithPrev — kept for callers (reducer move
 * validation, AI stepToward) that don't need path reconstruction.
 */
export function reachableTiles(state: BattleState, unitId: string): Set<string> {
  return reachableWithPrev(state, unitId).tiles;
}

/**
 * Reconstruct the shortest path from the search origin to `(destX, destY)` by
 * walking the parent-pointer map backward. Returns tiles in travel order
 * (element 0 is the start tile, last is the destination) or null if the
 * destination is unreachable.
 *
 * Hovering the start tile itself returns null (start has no prev entry —
 * there's no path to "where you already are").
 *
 * Direction-agnostic: the parent map encodes 8-dir steps as tile→tile links,
 * so this doesn't care whether a step was orthogonal or diagonal. O(path
 * length) — the Dijkstra search already happened when `prev` was built.
 */
export function pathTo(
  prev: Map<string, string>,
  destX: number,
  destY: number,
): Array<[number, number]> | null {
  let cur = `${destX},${destY}`;
  if (!prev.has(cur)) return null;

  const path: Array<[number, number]> = [[destX, destY]];
  // Cap at prev.size steps — a cycle in prev would otherwise loop forever.
  // Dijkstra never produces cycles, so this bound is never hit in practice;
  // it's a cheap seatbelt against a corrupted map.
  let steps = prev.size;
  while (prev.has(cur) && steps-- > 0) {
    cur = prev.get(cur)!;
    const comma = cur.indexOf(",");
    path.push([Number(cur.slice(0, comma)), Number(cur.slice(comma + 1))]);
  }
  path.reverse();
  return path;
}

/**
 * Finds the reachable tile that gets `unitId` closest to `(targetX, targetY)`.
 * Uses Chebyshev distance for target evaluation (matches PF2e reach rules).
 * Used by the AI to approach enemies when out of melee range. Returns null
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
  let bestDist = chebyshevDistance(unit.x, unit.y, targetX, targetY);
  let bestCost = Infinity;
  let bestKey = "";

  for (const [key, cost] of dist) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (x === unit.x && y === unit.y) continue;
    const d = chebyshevDistance(x, y, targetX, targetY);
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
