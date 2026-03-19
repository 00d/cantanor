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
  /** Parent *state* for each visited state, keyed by "x,y,parity".
   *  Walk back from `bestEntry[tile]` to reconstruct a parity-consistent
   *  path. State-keyed (not tile-keyed) because with PF2e alternating
   *  diagonals the optimal parent depends on the parity you arrive at —
   *  a tile-keyed map can stitch together segments with incompatible
   *  parity, producing a walk-back that costs more than `dist[dest]`. */
  statePrev: Map<string, string>;
  /** For each tile, the state key ("x,y,parity") that achieved `dist[tile]`.
   *  This is where path reconstruction starts. The start tile has no entry
   *  (there's no path to where you already are). */
  bestEntry: Map<string, string>;
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
  const statePrev = new Map<string, string>();
  const bestEntry = new Map<string, string>();

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
        // Record the parent *state*, not the parent tile — the walk-back
        // must stay on a single parity-consistent chain. `stateKey` is the
        // parent at the parity we're actually relaxing from.
        statePrev.set(nStateKey, stateKey);

        // Update best dist for this tile position. bestEntry records which
        // state key achieved it so pathTo knows where to start walking back.
        const knownTile = dist.get(nkey);
        if (knownTile === undefined || nc < knownTile) {
          dist.set(nkey, nc);
          bestEntry.set(nkey, nStateKey);
        }

        buckets[nc].push([nx, ny, nextParity]);
      }
    }
  }

  return { dist, statePrev, bestEntry };
}

/**
 * Reachability result — the tile set for range highlighting plus the
 * parity-aware walk-back maps. Computed together because all three come
 * from the same Dijkstra pass; the UI memoises this once on entering Move
 * mode and feeds `pathTo()` from the cache on every hover.
 */
export interface ReachResult {
  /** "x,y" keys the unit can end its move on. Start tile excluded. */
  tiles: Set<string>;
  /** Minimum cost to reach each tile, keyed by "x,y". Used by the UI to
   *  populate ProposedPath.cost so the player sees the movement price. */
  dist: Map<string, number>;
  /** State-level parent map ("x,y,parity" → "x,y,parity"). */
  statePrev: Map<string, string>;
  /** Per-tile entry point for walk-back ("x,y" → "x,y,parity"). */
  bestEntry: Map<string, string>;
}

/**
 * Run Dijkstra once from the unit's position and hand back everything needed
 * for range highlighting and path reconstruction. Callers hold onto the
 * result and feed it to `pathTo()` per hovered destination — no re-search
 * as the mouse moves.
 */
export function reachableWithPrev(state: BattleState, unitId: string): ReachResult {
  const unit = state.units[unitId];
  if (!unit) return { tiles: new Set(), dist: new Map(), statePrev: new Map(), bestEntry: new Map() };
  const speed = unit.speed ?? 5;
  const { dist, statePrev, bestEntry } = dijkstra(state, unit.x, unit.y, unitId, speed);
  const tiles = new Set<string>();
  const startKey = `${unit.x},${unit.y}`;
  for (const key of dist.keys()) {
    if (key !== startKey) tiles.add(key);
  }
  return { tiles, dist, statePrev, bestEntry };
}

/**
 * Returns the set of tile keys ("x,y") reachable by `unitId` within its
 * movement speed. Uses 8-connected movement with PF2e alternating diagonal cost.
 * Blocked and occupied tiles are walls. Corner-cutting is prevented.
 * The unit's own starting tile is excluded from the result.
 * Per-tile moveCost (default 1) is read from MapState.moveCost.
 *
 * Thin wrapper over reachableWithPrev — kept for callers (reducer move
 * validation, AI) that don't need path reconstruction.
 */
export function reachableTiles(state: BattleState, unitId: string): Set<string> {
  return reachableWithPrev(state, unitId).tiles;
}

/**
 * Reconstruct the shortest path from the search origin to `(destX, destY)`
 * by walking the state-level parent map backward. Returns tiles in travel
 * order — element 0 is the start, last is the destination — or null if the
 * destination is unreachable.
 *
 * The walk starts from `bestEntry[dest]` (the lowest-cost parity state for
 * that tile) and chases `statePrev` until it hits the origin state, which
 * has no entry. Because every step in the chain was recorded at a single
 * consistent parity, replaying the returned path from the start reproduces
 * exactly `dist[dest]` — no parity mismatch, no over-budget routes through
 * difficult terrain.
 *
 * Hovering the start tile returns null (start has no bestEntry — there's no
 * path to "where you already are").
 *
 * O(path length) — the search already ran when `reach` was built; this is
 * just pointer chasing.
 */
export function pathTo(
  reach: ReachResult,
  destX: number,
  destY: number,
): Array<[number, number]> | null {
  const entry = reach.bestEntry.get(`${destX},${destY}`);
  if (!entry) return null;

  const path: Array<[number, number]> = [[destX, destY]];
  let cur = entry;
  // Cap at statePrev.size steps — a cycle would otherwise loop forever.
  // Dijkstra never produces cycles; this is a cheap seatbelt.
  let steps = reach.statePrev.size;
  while (reach.statePrev.has(cur) && steps-- > 0) {
    cur = reach.statePrev.get(cur)!;
    // cur is "x,y,parity" — parity is always a single digit, so the
    // second comma cleanly separates y from parity.
    const c1 = cur.indexOf(",");
    const c2 = cur.indexOf(",", c1 + 1);
    path.push([Number(cur.slice(0, c1)), Number(cur.slice(c1 + 1, c2))]);
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
