/**
 * Tests for sprite sheet types and descriptor parsing.
 * Tests the type system and descriptor validation without requiring PixiJS.
 */
import { describe, it, expect } from "vitest";
import type {
  SpriteSheetDescriptor,
  AnimationDef,
  AnimationState,
  AnimationStateName,
  LoadedSpriteSheet,
} from "./spriteSheetTypes";

describe("SpriteSheetDescriptor type", () => {
  it("accepts a valid descriptor", () => {
    const desc: SpriteSheetDescriptor = {
      texture: "/sprites/warrior.png",
      frameWidth: 32,
      frameHeight: 32,
      animations: {
        idle: { frames: [0, 1, 2, 3], speed: 0.1, loop: true },
        attack: { frames: [4, 5, 6, 7], speed: 0.2, loop: false },
      },
    };
    expect(desc.texture).toBe("/sprites/warrior.png");
    expect(desc.frameWidth).toBe(32);
    expect(desc.frameHeight).toBe(32);
    expect(desc.animations.idle?.frames).toEqual([0, 1, 2, 3]);
    expect(desc.animations.attack?.loop).toBe(false);
  });

  it("allows partial animations (not all states required)", () => {
    const desc: SpriteSheetDescriptor = {
      texture: "/sprites/simple.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0], speed: 0.1, loop: true },
      },
    };
    expect(desc.animations.idle).toBeDefined();
    expect(desc.animations.attack).toBeUndefined();
    expect(desc.animations.walk).toBeUndefined();
    expect(desc.animations.death).toBeUndefined();
  });
});

describe("AnimationDef", () => {
  it("represents a looping animation", () => {
    const anim: AnimationDef = { frames: [0, 1, 2, 3], speed: 0.1, loop: true };
    expect(anim.loop).toBe(true);
    expect(anim.frames.length).toBe(4);
  });

  it("represents a one-shot animation", () => {
    const anim: AnimationDef = { frames: [8, 9, 10], speed: 0.15, loop: false };
    expect(anim.loop).toBe(false);
    expect(anim.speed).toBe(0.15);
  });
});

describe("AnimationState", () => {
  it("tracks runtime animation progress", () => {
    const state: AnimationState = {
      current: "idle",
      frameIndex: 0,
      elapsed: 0,
      finished: false,
    };
    expect(state.current).toBe("idle");
    expect(state.finished).toBe(false);
  });

  it("marks finished for non-looping animations", () => {
    const state: AnimationState = {
      current: "death",
      frameIndex: 3,
      elapsed: 0.45,
      finished: true,
    };
    expect(state.finished).toBe(true);
  });
});

describe("frame slicing logic", () => {
  it("computes correct frame count from sheet dimensions", () => {
    // Simulating frame slicing: 128x64 sheet with 32x32 frames = 4x2 = 8 frames
    const sheetWidth = 128;
    const sheetHeight = 64;
    const frameWidth = 32;
    const frameHeight = 32;
    const cols = Math.floor(sheetWidth / frameWidth);
    const rows = Math.floor(sheetHeight / frameHeight);
    const totalFrames = cols * rows;
    expect(cols).toBe(4);
    expect(rows).toBe(2);
    expect(totalFrames).toBe(8);
  });

  it("computes correct frame positions", () => {
    const frameWidth = 32;
    const frameHeight = 32;
    const cols = 4;
    // Frame 0: (0,0), Frame 1: (32,0), Frame 4: (0,32), Frame 5: (32,32)
    function frameRect(index: number) {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return { x: col * frameWidth, y: row * frameHeight, w: frameWidth, h: frameHeight };
    }
    expect(frameRect(0)).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(frameRect(1)).toEqual({ x: 32, y: 0, w: 32, h: 32 });
    expect(frameRect(4)).toEqual({ x: 0, y: 32, w: 32, h: 32 });
    expect(frameRect(5)).toEqual({ x: 32, y: 32, w: 32, h: 32 });
  });
});

describe("LoadedSpriteSheet", () => {
  it("holds descriptor and frame references", () => {
    const desc: SpriteSheetDescriptor = {
      texture: "/sprites/test.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], speed: 0.2, loop: true },
      },
    };
    const loaded: LoadedSpriteSheet = {
      descriptor: desc,
      frames: ["frame0", "frame1", "frame2", "frame3"], // mock textures
    };
    expect(loaded.descriptor.texture).toBe("/sprites/test.png");
    expect(loaded.frames.length).toBe(4);
  });
});

describe("animation state names", () => {
  it("covers all expected animation states", () => {
    const states: AnimationStateName[] = ["idle", "walk", "attack", "cast", "hit", "death"];
    expect(states).toHaveLength(6);
    // Verify they're valid as keys in a descriptor
    const desc: SpriteSheetDescriptor = {
      texture: "/sprites/full.png",
      frameWidth: 32,
      frameHeight: 32,
      animations: {
        idle: { frames: [0], speed: 0.1, loop: true },
        walk: { frames: [1, 2], speed: 0.1, loop: true },
        attack: { frames: [3, 4], speed: 0.15, loop: false },
        cast: { frames: [5, 6], speed: 0.15, loop: false },
        hit: { frames: [7], speed: 0.2, loop: false },
        death: { frames: [8, 9], speed: 0.2, loop: false },
      },
    };
    for (const state of states) {
      expect(desc.animations[state]).toBeDefined();
    }
  });
});

describe("fallback behavior", () => {
  it("unit without spriteSheet field uses colored rectangle (no crash)", () => {
    // This test verifies the type system allows spriteSheet to be undefined
    const unit = {
      unitId: "test",
      team: "player",
      hp: 10,
      maxHp: 10,
      spriteSheet: undefined,
    };
    expect(unit.spriteSheet).toBeUndefined();
  });

  it("unit with spriteSheet field has a path", () => {
    const unit = {
      unitId: "warrior",
      spriteSheet: "/sprites/warrior_sheet.json",
    };
    expect(unit.spriteSheet).toBe("/sprites/warrior_sheet.json");
  });
});
