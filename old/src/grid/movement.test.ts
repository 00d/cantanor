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

describe("pathTo", () => {
  it("reconstructs a path that starts at the unit and ends at the destination", () => {
    const battle = createTestBattle({
      units: { u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 5 }) },
    });
    const { prev } = reachableWithPrev(battle, "u");
    const path = pathTo(prev, 4, 1);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([1, 1]);                    // start
    expect(path![path!.length - 1]).toEqual([4, 1]);     // dest
    // Every step is an 8-connected neighbour (Chebyshev dist 1)
    for (let i = 1; i < path!.length; i++) {
      const [px, py] = path![i - 1];
      const [cx, cy] = path![i];
      expect(chebyshevDistance(px, py, cx, cy)).toBe(1);
    }
  });

  it("returns null for the start tile (no path to where you already are)", () => {
    const battle = createTestBattle({
      units: { u: createTestUnit({ unitId: "u", x: 2, y: 2, speed: 3 }) },
    });
    const { prev } = reachableWithPrev(battle, "u");
    expect(pathTo(prev, 2, 2)).toBeNull();
  });

  it("returns null for an unreachable tile", () => {
    const battle = createTestBattle({
      units: { u: createTestUnit({ unitId: "u", x: 0, y: 0, speed: 2 }) },
    });
    const { prev } = reachableWithPrev(battle, "u");
    // (9,9) is far beyond speed 2
    expect(pathTo(prev, 9, 9)).toBeNull();
  });

  it("includes diagonal steps when the prev map encodes them", () => {
    // On an open map, the shortest path to a tile straight along a diagonal
    // axis is a single diagonal step. Verifies pathTo doesn't restrict to
    // orthogonal — it just walks whatever prev says.
    const battle = createTestBattle({
      units: { u: createTestUnit({ unitId: "u", x: 5, y: 5, speed: 3 }) },
    });
    const { prev } = reachableWithPrev(battle, "u");
    const path = pathTo(prev, 6, 6);
    expect(path).toEqual([[5, 5], [6, 6]]);  // one diagonal step
  });

  it("routes around a wall rather than through it", () => {
    // Wall tiles block (2,1) — a straight-line path from (1,1) to (3,1)
    // must detour. We don't assert the exact detour (multiple valid shortest
    // paths exist with 8-dir), only that the result never steps on the wall.
    const battle = createTestBattle({
      battleMap: { width: 10, height: 10, blocked: [[2, 1]] },
      units: { u: createTestUnit({ unitId: "u", x: 1, y: 1, speed: 5 }) },
    });
    const { prev } = reachableWithPrev(battle, "u");
    const path = pathTo(prev, 3, 1);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([1, 1]);
    expect(path![path!.length - 1]).toEqual([3, 1]);
    for (const [x, y] of path!) {
      expect(x === 2 && y === 1).toBe(false);  // never steps on the wall
    }
    // And every step is still an adjacent move
    for (let i = 1; i < path!.length; i++) {
      const [px, py] = path![i - 1];
      const [cx, cy] = path![i];
      expect(chebyshevDistance(px, py, cx, cy)).toBe(1);
    }
  });
});
