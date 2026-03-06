import { describe, it, expect } from "vitest";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import {
  reachableTiles,
  reachableWithPrev,
  pathTo,
  stepToward,
  canStepTo,
  chebyshevDistance,
} from "./movement";
import type { BattleState } from "../engine/state";

/** Asserts every consecutive pair in `path` is a legal single step in `state`
 *  — Chebyshev distance 1, not blocked/occupied, and diagonal corners clear.
 *  This is the same ruleset as dijkstra's neighbor loop; if a walk-back path
 *  violates it, the prev map has stitched together an impossible route. */
function isLegalWalk(path: Array<[number, number]>, state: BattleState): boolean {
  const blocked = new Set(state.battleMap.blocked.map(([x, y]) => `${x},${y}`));
  const occupied = new Set(
    Object.values(state.units).filter((u) => u.hp > 0).map((u) => `${u.x},${u.y}`),
  );
  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1];
    const [x, y] = path[i];
    const dx = x - px, dy = y - py;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
    if (blocked.has(`${x},${y}`)) return false;
    // Step target occupied? (Start tile is the unit's own, fine; intermediate/dest must be clear.)
    if (occupied.has(`${x},${y}`)) return false;
    // Corner-cutting prevention for diagonals
    if (dx !== 0 && dy !== 0) {
      if (blocked.has(`${px + dx},${py}`) || occupied.has(`${px + dx},${py}`)) return false;
      if (blocked.has(`${px},${py + dy}`) || occupied.has(`${px},${py + dy}`)) return false;
    }
  }
  return true;
}

/** Replay a path from the start with parity tracking and return total cost.
 *  Mirrors dijkstra's cost model exactly — this is the "does the walk-back
 *  path actually fit in the budget" check that motivated the parity-aware
 *  prev map (Option A, Phase 14 M4). */
function replayCost(path: Array<[number, number]>, state: BattleState): number {
  let cost = 0;
  let parity = 0;
  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1];
    const [x, y] = path[i];
    const tileCost = state.battleMap.moveCost?.[`${x},${y}`] ?? 1;
    const isDiag = (x - px) !== 0 && (y - py) !== 0;
    if (isDiag) {
      cost += parity === 0 ? tileCost : tileCost * 2;
      parity = 1 - parity;
    } else {
      cost += tileCost;
    }
  }
  return cost;
}

describe("chebyshevDistance", () => {
  it("returns max of axis deltas", () => {
    expect(chebyshevDistance(0, 0, 3, 4)).toBe(4);
    expect(chebyshevDistance(0, 0, 5, 2)).toBe(5);
    expect(chebyshevDistance(2, 3, 2, 3)).toBe(0);
    expect(chebyshevDistance(0, 0, 3, 3)).toBe(3);
  });
});

describe("8-connected reachability", () => {
  it("includes diagonal tiles on an open map", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 1 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Speed 1: can reach all 8 adjacent tiles
    expect(tiles.has("5,6")).toBe(true);
    expect(tiles.has("6,5")).toBe(true);
    expect(tiles.has("6,6")).toBe(true); // diagonal
    expect(tiles.has("4,4")).toBe(true); // diagonal
    expect(tiles.size).toBe(8);
  });

  it("alternating diagonal cost: speed 2 allows first 2 diags cost 1+2=3 (exceeds budget)", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 2 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Two diagonals in same direction: cost 1 (parity 0→1) + 2 (parity 1→0) = 3 > 2
    // So (7,7) should not be reachable via pure diagonal
    expect(tiles.has("7,7")).toBe(false);
    // But (6,6) at 1 diagonal is reachable (cost 1)
    expect(tiles.has("6,6")).toBe(true);
    // (7,5) via 2 orthogonal is reachable (cost 2)
    expect(tiles.has("7,5")).toBe(true);
  });

  it("speed 3 allows 2 diagonals (cost 1+2=3)", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 3 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Two diagonals: cost 3
    expect(tiles.has("7,7")).toBe(true);
    expect(tiles.has("3,3")).toBe(true);
  });

  it("mixed orthogonal/diagonal paths preserve correct parity", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 3 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // orthogonal + diagonal + orthogonal = cost 1+1+1 = 3 (diagonal at parity 0 costs 1)
    // Should reach (6,7) via (5,6) then (6,7) diagonal = 1+1=2, or orthogonal steps
    expect(tiles.has("6,7")).toBe(true);
    // (5,8) via 3 orthogonal
    expect(tiles.has("5,8")).toBe(true);
  });

  it("difficult terrain doubles diagonal cost on parity 1", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 5 }),
      },
      battleMap: {
        width: 10, height: 10, blocked: [],
        moveCost: { "6,6": 2 },
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Direct diagonal to (6,6) at parity 0: cost = 2*1 = 2 (tileCost × 1 for parity 0)
    expect(tiles.has("6,6")).toBe(true);
  });

  it("corner-cutting blocked by adjacent walls (speed 1 — no orthogonal route)", () => {
    // With speed 1, (2,2) is only reachable via direct diagonal from (1,1).
    // The wall at (2,1) blocks the diagonal corner-cut.
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 1 }),
      },
      battleMap: {
        width: 10, height: 10,
        blocked: [[2, 1]], // wall to the right
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Diagonal to (2,2) is blocked because (2,1) is a wall — and speed 1 means no orthogonal route
    expect(tiles.has("2,2")).toBe(false);
    // Diagonal to (2,0) is also blocked because (2,1) is a wall
    expect(tiles.has("2,0")).toBe(false);
    // But (0,0) diagonal should be fine (no blocking corners)
    expect(tiles.has("0,0")).toBe(true);
    // And (0,2) diagonal should be fine
    expect(tiles.has("0,2")).toBe(true);
  });

  it("corner-cutting blocked by occupied tiles (speed 1 — no orthogonal route)", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 1 }),
        blocker: createTestUnit({ unitId: "blocker", team: "enemy", x: 2, y: 1 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Diagonal to (2,2) blocked by occupied (2,1) — speed 1 means no orthogonal route
    expect(tiles.has("2,2")).toBe(false);
    expect(tiles.has("2,0")).toBe(false);
  });

  it("backward compat: existing orthogonal paths still work", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 3 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Orthogonal moves still work
    expect(tiles.has("1,0")).toBe(true);
    expect(tiles.has("2,0")).toBe(true);
    expect(tiles.has("3,0")).toBe(true);
    expect(tiles.has("0,1")).toBe(true);
    expect(tiles.has("0,2")).toBe(true);
    expect(tiles.has("0,3")).toBe(true);
  });

  it("edge cases: map corners", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 2 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    // At corner (0,0), only 3 directions available
    expect(tiles.has("1,0")).toBe(true);
    expect(tiles.has("0,1")).toBe(true);
    expect(tiles.has("1,1")).toBe(true); // diagonal
    // Out of bounds
    expect(tiles.has("-1,0")).toBe(false);
  });

  it("surrounded unit cannot move", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 5 }),
        n: createTestUnit({ unitId: "n", team: "enemy", x: 1, y: 0 }),
        s: createTestUnit({ unitId: "s", team: "enemy", x: 1, y: 2 }),
        e: createTestUnit({ unitId: "e", team: "enemy", x: 2, y: 1 }),
        w: createTestUnit({ unitId: "w", team: "enemy", x: 0, y: 1 }),
        ne: createTestUnit({ unitId: "ne", team: "enemy", x: 2, y: 0 }),
        nw: createTestUnit({ unitId: "nw", team: "enemy", x: 0, y: 0 }),
        se: createTestUnit({ unitId: "se", team: "enemy", x: 2, y: 2 }),
        sw: createTestUnit({ unitId: "sw", team: "enemy", x: 0, y: 2 }),
      },
    });
    const tiles = reachableTiles(battle, "u");
    expect(tiles.size).toBe(0);
  });

  it("moveCost=3 (very difficult terrain) costs 3 per orthogonal step", () => {
    // Wall off rows above and below so unit must go through the difficult tile
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 3 }),
      },
      battleMap: {
        width: 10, height: 2, blocked: [],
        moveCost: { "1,0": 3 },
      },
    });
    const tiles = reachableTiles(battle, "u");
    // (1,0) costs 3 — exactly budget, reachable
    expect(tiles.has("1,0")).toBe(true);
    // (2,0) would cost 3+1=4 > 3 via difficult tile — but can go (0,1)→(1,1)→(2,0) = 3
    // To force through the tile, use a 1-row map:
    const battle1row = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 3 }),
      },
      battleMap: {
        width: 10, height: 1, blocked: [],
        moveCost: { "1,0": 3 },
      },
    });
    const tiles1 = reachableTiles(battle1row, "u");
    expect(tiles1.has("1,0")).toBe(true);
    // (2,0) costs 3+1=4 > 3 — cannot reach in a 1-row map
    expect(tiles1.has("2,0")).toBe(false);
  });

  it("path through multiple difficult terrain tiles — cumulative cost limits reachability", () => {
    // Use a 1-row corridor so all travel is orthogonal through difficult terrain
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 5 }),
      },
      battleMap: {
        width: 10, height: 1, blocked: [],
        moveCost: { "1,0": 2, "2,0": 2 },
      },
    });
    const tiles = reachableTiles(battle, "u");
    // (1,0) costs 2, (2,0) costs 2+2=4 — both within budget 5
    expect(tiles.has("1,0")).toBe(true);
    expect(tiles.has("2,0")).toBe(true);
    // (3,0) costs 4+1=5 — exactly at budget, reachable
    expect(tiles.has("3,0")).toBe(true);
    // (4,0) costs 5+1=6 > 5 — not reachable
    expect(tiles.has("4,0")).toBe(false);
  });

  it("moveCost on a blocked tile — blocked takes priority (unreachable)", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 5 }),
      },
      battleMap: {
        width: 10, height: 10, blocked: [[6, 5]],
        moveCost: { "6,5": 2 },
      },
    });
    const tiles = reachableTiles(battle, "u");
    // Blocked tile is never reachable regardless of moveCost
    expect(tiles.has("6,5")).toBe(false);
  });
});

describe("canStepTo (8-connected)", () => {
  it("allows orthogonal adjacency", () => {
    const battle = createTestBattle();
    const unit = createTestUnit({ x: 5, y: 5 });
    expect(canStepTo(battle, unit, 5, 6)).toBe(true);
    expect(canStepTo(battle, unit, 6, 5)).toBe(true);
  });

  it("allows diagonal adjacency", () => {
    const battle = createTestBattle();
    const unit = createTestUnit({ x: 5, y: 5 });
    expect(canStepTo(battle, unit, 6, 6)).toBe(true);
    expect(canStepTo(battle, unit, 4, 4)).toBe(true);
  });

  it("blocks diagonal when corner tile is a wall", () => {
    const battle = createTestBattle({
      battleMap: { width: 10, height: 10, blocked: [[6, 5]] },
    });
    const unit = createTestUnit({ x: 5, y: 5 });
    expect(canStepTo(battle, unit, 6, 6)).toBe(false);
  });

  it("rejects non-adjacent tiles", () => {
    const battle = createTestBattle();
    const unit = createTestUnit({ x: 5, y: 5 });
    expect(canStepTo(battle, unit, 7, 5)).toBe(false);
    expect(canStepTo(battle, unit, 5, 5)).toBe(false); // same tile
  });
});

describe("reachableWithPrev + pathTo", () => {
  it("returns the same tile set as reachableTiles", () => {
    // Back-compat guard: reachableTiles is now a wrapper, make sure the
    // wrapper and the direct call agree bit-for-bit so the reducer's move
    // validation (which still calls reachableTiles) isn't drifted.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 3, y: 3, speed: 4 }) },
    });
    const viaWrapper = reachableTiles(battle, "hero");
    const viaDirect  = reachableWithPrev(battle, "hero").tiles;

    expect(viaDirect).toEqual(viaWrapper);
    expect(viaDirect.has("3,3")).toBe(false);   // start tile stays excluded
  });

  it("returns empty everything for an unknown unit", () => {
    const battle = createTestBattle();
    const reach = reachableWithPrev(battle, "ghost");
    expect(reach.tiles.size).toBe(0);
    expect(reach.statePrev.size).toBe(0);
    expect(reach.bestEntry.size).toBe(0);
  });

  it("reconstructs a straight orthogonal path on an open map", () => {
    // (0,0)→(4,0): purely orthogonal, no diagonals involved. The shortest
    // path is the obvious straight shot at cost 4; any diagonal detour
    // would be longer. Exact-sequence assertion is safe here.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0, speed: 5 }) },
    });
    const reach = reachableWithPrev(battle, "hero");
    const path = pathTo(reach, 4, 0);
    expect(path).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  });

  it("routes around walls with legal steps", () => {
    // Wall column at x=1, y=1..2. Don't assert which side the path takes —
    // only that whatever it picks is a legal 8-connected walk that starts
    // at S, ends at D, and never steps onto a blocked tile. Pinning the
    // exact route would make this brittle against a valid tie-break change.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 1, y: 0, speed: 8 }) },
      battleMap: { width: 5, height: 4, blocked: [[1, 1], [1, 2]] },
    });
    const reach = reachableWithPrev(battle, "hero");
    expect(reach.tiles.has("1,3")).toBe(true);

    const path = pathTo(reach, 1, 3)!;
    expect(path[0]).toEqual([1, 0]);
    expect(path[path.length - 1]).toEqual([1, 3]);
    expect(isLegalWalk(path, battle)).toBe(true);
  });

  it("path length is Chebyshev+1 on open uniform-cost terrain", () => {
    // With 8-connected movement and no obstacles, the shortest path to any
    // tile uses Chebyshev-distance steps (diagonals cover both axes at once).
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 5, y: 5, speed: 6 }) },
    });
    const reach = reachableWithPrev(battle, "hero");

    // (5,5) → (8,3): Chebyshev max(3,2) = 3 steps → 4 tiles
    const path = pathTo(reach, 8, 3)!;
    expect(path.length).toBe(4);
    expect(isLegalWalk(path, battle)).toBe(true);
  });

  it("parity correctness: walk-back through difficult terrain stays in budget", () => {
    // This is the scenario that motivated parity-aware prev (Option A).
    // moveCost[2,2]=3. Naive tile-level prev can record (1,1)→(2,2) from
    // the parity-0 relaxation while (1,1)'s own prev was recorded at parity
    // 1 (via diagonal from S). Walking that chain forward replays as two
    // diagonals: 1 + 3×2 = 7. The parity-aware prev instead walks back
    // along a consistent chain whose replay cost = dist[dest] = 5.
    //
    // We don't assert the exact path — only that its replay cost matches
    // the Dijkstra distance, proving the walk-back is parity-consistent.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0, speed: 5 }) },
      battleMap: {
        width: 5, height: 5, blocked: [],
        moveCost: { "2,2": 3 },
      },
    });
    const reach = reachableWithPrev(battle, "hero");
    expect(reach.tiles.has("2,2")).toBe(true);

    const path = pathTo(reach, 2, 2)!;
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([2, 2]);
    expect(isLegalWalk(path, battle)).toBe(true);
    // THE assertion: replayed cost ≤ speed. Naive prev would give 7 here.
    expect(replayCost(path, battle)).toBeLessThanOrEqual(5);
  });

  it("every reachable tile's walk-back replays within budget (open + difficult mix)", () => {
    // Sweep assertion: for EVERY tile in reach, pathTo gives a route whose
    // replayed cost is ≤ speed. This is the contract the path preview relies
    // on — if any tile fails, the chevrons would show an impossible route.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 3, y: 3, speed: 5 }) },
      battleMap: {
        width: 10, height: 10, blocked: [[4, 4]],
        moveCost: { "5,5": 2, "4,3": 3, "2,2": 2 },
      },
    });
    const reach = reachableWithPrev(battle, "hero");
    const speed = 5;

    for (const key of reach.tiles) {
      const [x, y] = key.split(",").map(Number);
      const path = pathTo(reach, x, y)!;
      expect(path).not.toBeNull();
      expect(path[0]).toEqual([3, 3]);
      expect(path[path.length - 1]).toEqual([x, y]);
      expect(isLegalWalk(path, battle)).toBe(true);
      expect(replayCost(path, battle)).toBeLessThanOrEqual(speed);
    }
  });

  it("returns null for an unreachable tile", () => {
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0, speed: 2 }) },
    });
    const reach = reachableWithPrev(battle, "hero");
    expect(pathTo(reach, 7, 7)).toBeNull();
  });

  it("returns null for the start tile itself", () => {
    // Start tile has no bestEntry — "path to where I already am" is a
    // non-concept. The UI uses this to avoid drawing a lone ring under
    // the unit's feet when the cursor happens to be over its own tile.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 2, y: 2, speed: 5 }) },
    });
    const reach = reachableWithPrev(battle, "hero");
    expect(pathTo(reach, 2, 2)).toBeNull();
  });

  it("handles a 1-step path (adjacent destination)", () => {
    // Edge case for the renderer: a 2-element path means no intermediate
    // chevrons, just the landing ring.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 3, y: 3, speed: 5 }) },
    });
    const reach = reachableWithPrev(battle, "hero");
    expect(pathTo(reach, 4, 3)).toEqual([[3, 3], [4, 3]]);   // orthogonal
    expect(pathTo(reach, 4, 4)).toEqual([[3, 3], [4, 4]]);   // diagonal
  });
});

describe("stepToward (Chebyshev distance)", () => {
  it("approaches diagonally when shorter", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 1 }),
      },
    });
    const step = stepToward(battle, "u", 5, 5);
    // Diagonal step to (1,1) is Chebyshev distance 4 from target
    // Orthogonal step to (1,0) is Chebyshev distance 5 from target
    expect(step).toEqual([1, 1]);
  });

  it("returns null when no reachable tile improves distance", () => {
    const battle = createTestBattle({
      units: {
        u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 5 }),
        n: createTestUnit({ unitId: "n", team: "enemy", x: 1, y: 0 }),
        s: createTestUnit({ unitId: "s", team: "enemy", x: 1, y: 2 }),
        e: createTestUnit({ unitId: "e", team: "enemy", x: 2, y: 1 }),
        w: createTestUnit({ unitId: "w", team: "enemy", x: 0, y: 1 }),
        ne: createTestUnit({ unitId: "ne", team: "enemy", x: 2, y: 0 }),
        nw: createTestUnit({ unitId: "nw", team: "enemy", x: 0, y: 0 }),
        se: createTestUnit({ unitId: "se", team: "enemy", x: 2, y: 2 }),
        sw: createTestUnit({ unitId: "sw", team: "enemy", x: 0, y: 2 }),
      },
    });
    const step = stepToward(battle, "u", 5, 5);
    expect(step).toBeNull();
  });
});
