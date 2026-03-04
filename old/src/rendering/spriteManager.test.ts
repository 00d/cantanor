/**
 * Tween convergence + animation-gate tests for spriteManager.
 *
 * PixiJS is mocked with bare-minimum stubs: Container needs a children array,
 * addChild/removeChild, a position object with set(), and destroy/sortChildren.
 * Graphics/Text need only no-op draw methods that return `this` for chaining.
 * We're testing the lerp math and the activeAnimCount bookkeeping — not WebGL.
 *
 * Module-level sprite state (`_sprites`) persists across tests, so every test
 * calls clearUnits() in cleanup.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

// --- PixiJS mock -----------------------------------------------------------
// Hoisted by vitest, so this MUST come before the spriteManager import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock("pixi.js", () => {
  class Position {
    x = 0;
    y = 0;
    set(x: number, y: number) { this.x = x; this.y = y; }
  }
  class Container {
    children: unknown[] = [];
    position = new Position();
    alpha = 1;
    zIndex = 0;
    label = "";
    addChild(c: unknown)    { this.children.push(c); }
    removeChild(c: unknown) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
    sortChildren()          { /* zIndex sort is cosmetic */ }
    destroy()               { this.children.length = 0; }
  }
  // Graphics chain-returns `this` so .rect().fill().rect().fill() works.
  class Graphics {
    clear()          { return this; }
    roundRect()      { return this; }
    rect()           { return this; }
    fill()           { return this; }
    stroke()         { return this; }
    setStrokeStyle() { return this; }
  }
  class Text {
    text = "";
    style: unknown;
    alpha = 1;
    anchor = { set() {} };
    position = new Position();
    constructor(opts: { text: string; style: unknown }) {
      this.text = opts.text;
      this.style = opts.style;
    }
  }
  class TextStyle { constructor(_: unknown) {} }
  return { Container, Graphics, Text, TextStyle };
});

// pixiApp pulls in the real pixi.js Application at module load — stub TILE_SIZE
// so we don't transitively import the unmocked bits.
vi.mock("./pixiApp", () => ({ TILE_SIZE: 64 }));

import { syncUnits, tickSprites, snapAllSprites, clearUnits } from "./spriteManager";
import type { TransientState } from "../store/battleStore";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import { Container } from "pixi.js";

const TILE = 64;

function makeTransient(): TransientState {
  return { animationQueue: [], activeAnimCount: 0 };
}

describe("spriteManager tween", () => {
  afterEach(() => {
    clearUnits();
  });

  it("snaps a newly created sprite to its spawn tile (no tween from origin)", () => {
    const parent = new Container();
    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 3, y: 2 }) },
    });

    syncUnits(parent, battle, null, null);

    // One tick with nothing to do — sprite should already be at rest.
    const t = makeTransient();
    tickSprites(16, t);

    const sprite = parent.children[0] as { position: { x: number; y: number } };
    expect(sprite.position.x).toBe(3 * TILE);
    expect(sprite.position.y).toBe(2 * TILE);
    expect(t.activeAnimCount).toBe(0);
  });

  it("arms a tween when target changes and converges to the exact target", () => {
    const parent = new Container();
    const t = makeTransient();

    // Spawn at (1,1)
    let battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 1, y: 1 }) },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(0);

    // Move to (4,1) — syncUnits sets new target, tween arms
    battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 4, y: 1 }) },
    });
    syncUnits(parent, battle, null, null);

    // First frame: sprite has left the start tile, counter reads 1
    tickSprites(16, t);
    const sprite = parent.children[0] as { position: { x: number; y: number } };
    expect(sprite.position.x).toBeGreaterThan(1 * TILE);
    expect(sprite.position.x).toBeLessThan(4 * TILE);
    expect(t.activeAnimCount).toBe(1);

    // Drive to completion. TWEEN_MS is 280; at 16ms/frame that's 18 frames.
    // Give it 30 for headroom — the loop should settle before then.
    for (let i = 0; i < 30; i++) tickSprites(16, t);

    // Exact landing — not just "close"
    expect(sprite.position.x).toBe(4 * TILE);
    expect(sprite.position.y).toBe(1 * TILE);
    expect(t.activeAnimCount).toBe(0);
  });

  it("counts two simultaneous movers and drains to zero together", () => {
    const parent = new Container();
    const t = makeTransient();

    let battle = createTestBattle({
      units: {
        a: createTestUnit({ unitId: "a", x: 0, y: 0 }),
        b: createTestUnit({ unitId: "b", x: 5, y: 5 }),
      },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);

    // Both move at once (e.g. a spell with forced movement)
    battle = createTestBattle({
      units: {
        a: createTestUnit({ unitId: "a", x: 2, y: 0 }),
        b: createTestUnit({ unitId: "b", x: 5, y: 3 }),
      },
    });
    syncUnits(parent, battle, null, null);

    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(2);

    for (let i = 0; i < 30; i++) tickSprites(16, t);
    expect(t.activeAnimCount).toBe(0);
  });

  it("cuts the corner on mid-tween re-target instead of rubber-banding", () => {
    const parent = new Container();
    const t = makeTransient();

    // Start at (0,0)
    let battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0 }) },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);

    // Move toward (5,0)
    battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 5, y: 0 }) },
    });
    syncUnits(parent, battle, null, null);

    // Run a few frames — sprite is somewhere in the middle
    for (let i = 0; i < 5; i++) tickSprites(16, t);
    const sprite = parent.children[0] as { position: { x: number; y: number } };
    const midX = sprite.position.x;
    expect(midX).toBeGreaterThan(0);
    expect(midX).toBeLessThan(5 * TILE);

    // Re-target to (5,3) mid-flight
    battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 5, y: 3 }) },
    });
    syncUnits(parent, battle, null, null);

    // Next frame must continue from midX — if it snapped back to 0 or to
    // the previous target, this assertion catches it.
    tickSprites(16, t);
    expect(sprite.position.x).toBeGreaterThanOrEqual(midX);
    expect(sprite.position.y).toBeGreaterThan(0); // started heading down

    for (let i = 0; i < 30; i++) tickSprites(16, t);
    expect(sprite.position.x).toBe(5 * TILE);
    expect(sprite.position.y).toBe(3 * TILE);
  });

  it("snapAllSprites forces immediate settlement", () => {
    const parent = new Container();
    const t = makeTransient();

    let battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 0, y: 0 }) },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);

    battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 6, y: 4 }) },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(1);

    snapAllSprites();

    const sprite = parent.children[0] as { position: { x: number; y: number } };
    expect(sprite.position.x).toBe(6 * TILE);
    expect(sprite.position.y).toBe(4 * TILE);

    // Counter is stale until the next tick writes it — that's the contract.
    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(0);
  });

  it("does not re-arm the tween when syncUnits runs with an unchanged position", () => {
    // Regression guard: syncUnits fires on every React render (selection
    // change, HP change, etc). It must not reset lerpT if the unit hasn't
    // moved, or the sprite would twitch on every re-render.
    const parent = new Container();
    const t = makeTransient();

    const battle = createTestBattle({
      units: { hero: createTestUnit({ unitId: "hero", x: 2, y: 2 }) },
    });
    syncUnits(parent, battle, null, null);
    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(0);

    // Same position, just a re-render (e.g. selectedUnitId changed)
    syncUnits(parent, battle, "hero", null);
    tickSprites(16, t);
    expect(t.activeAnimCount).toBe(0);
  });
});
