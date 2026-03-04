/**
 * Tests for path reconstruction — reachableWithPrev + pathTo.
 *
 * The Dijkstra itself is exercised transitively by the regression-hash
 * suite (reducer move validation calls reachableTiles). These tests focus
 * on the prev-map walk-back: does pathTo hand back a real route, in the
 * right order, with each step a legal cardinal move?
 */

import { describe, it, expect } from "vitest";
import { reachableWithPrev, reachableTiles, pathTo } from "./movement";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";

/** Asserts every consecutive pair in `path` is a single cardinal step. */
function isCardinalWalk(path: Array<[number, number]>): boolean {
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i][0] - path[i - 1][0]);
    const dy = Math.abs(path[i][1] - path[i - 1][1]);
    if (dx + dy !== 1) return false;   // exactly one axis moves exactly one
  }
  return true;
}

describe("reachableWithPrev", () => {
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

  it("returns empty sets for an unknown unit", () => {
    const battle = createTestBattle();
    const { tiles, prev } = reachableWithPrev(battle, "ghost");
    expect(tiles.size).toBe(0);
    expect(prev.size).toBe(0);
  });
});

describe("pathTo", () => {
  it("reconstructs a straight-line path on an open map", () => {
    // 10×10 open map, unit at (0,0), speed 5. Walk to (4,0) — no obstacles,
    // so the shortest path is the obvious straight shot.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0, speed: 5 }) },
    });
    const { prev } = reachableWithPrev(battle, "hero");
    const path = pathTo(prev, 4, 0);

    expect(path).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  });

  it("produces a legal cardinal walk that routes around walls", () => {
    // Corridor with a wall forcing a detour:
    //
    //   0 1 2 3 4   x→
    // 0 S . . . .
    // 1 . # . . .
    // 2 . # . . .
    // 3 . . D . .
    //
    // Straight-down from (1,0) is blocked. The path has to step around the
    // wall column. We don't assert which side it takes — only that whatever
    // it picks is (a) cardinal-only, (b) starts at S and ends at D, and
    // (c) never steps onto a blocked tile. Pinning the exact route would
    // make this test brittle against a valid tie-break change in Dijkstra.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 1, y: 0, speed: 8 }) },
      battleMap: {
        width: 5,
        height: 4,
        blocked: [[1, 1], [1, 2]],
      },
    });
    const { prev, tiles } = reachableWithPrev(battle, "hero");
    expect(tiles.has("1,3")).toBe(true);

    const path = pathTo(prev, 1, 3)!;
    expect(path).not.toBeNull();
    expect(path[0]).toEqual([1, 0]);
    expect(path[path.length - 1]).toEqual([1, 3]);
    expect(isCardinalWalk(path)).toBe(true);

    const blocked = new Set(["1,1", "1,2"]);
    for (const [x, y] of path) {
      expect(blocked.has(`${x},${y}`)).toBe(false);
    }
  });

  it("path length matches movement cost on uniform-cost terrain", () => {
    // On a cost-1 map, shortest path to a tile at Manhattan distance d is
    // exactly d steps → path has d+1 tiles (includes start).
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 5, y: 5, speed: 6 }) },
    });
    const { prev } = reachableWithPrev(battle, "hero");

    // (5,5) → (8,3): Manhattan distance 3+2 = 5
    const path = pathTo(prev, 8, 3)!;
    expect(path.length).toBe(6);
    expect(isCardinalWalk(path)).toBe(true);
  });

  it("returns null for an unreachable tile", () => {
    // Speed 2 from (0,0) — (5,5) is Manhattan-10 away.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0, speed: 2 }) },
    });
    const { prev } = reachableWithPrev(battle, "hero");
    expect(pathTo(prev, 5, 5)).toBeNull();
  });

  it("returns null for the start tile itself", () => {
    // Start tile has no prev entry by design — "path to where I already am"
    // is a non-concept. The UI uses this to avoid drawing a lone ring under
    // the unit's feet when the mouse happens to be over its own tile.
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 2, y: 2, speed: 5 }) },
    });
    const { prev } = reachableWithPrev(battle, "hero");
    expect(pathTo(prev, 2, 2)).toBeNull();
  });

  it("treats other living units as walls", () => {
    // An ally parked at (2,0) should force the path to detour.
    // Same property-based assertion style as the wall test.
    const battle = createTestBattle({
      units: {
        hero:    createTestUnit({ unitId: "hero",    x: 0, y: 0, speed: 6 }),
        blocker: createTestUnit({ unitId: "blocker", x: 2, y: 0 }),
      },
    });
    const { prev, tiles } = reachableWithPrev(battle, "hero");

    // Destination past the blocker is still reachable (detour via y=1)
    expect(tiles.has("4,0")).toBe(true);

    const path = pathTo(prev, 4, 0)!;
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([4, 0]);
    expect(isCardinalWalk(path)).toBe(true);
    // The path must step around the blocker, not through it
    for (const [x, y] of path) {
      expect(x === 2 && y === 0).toBe(false);
    }
  });

  it("handles a 1-step path (adjacent destination)", () => {
    // Edge case for the renderer: a 2-element path means no intermediate
    // chevrons, just the landing ring. pathTo still has to hand back [start, dest].
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 3, y: 3, speed: 5 }) },
    });
    const { prev } = reachableWithPrev(battle, "hero");
    const path = pathTo(prev, 4, 3);
    expect(path).toEqual([[3, 3], [4, 3]]);
  });
});
