/**
 * Sprite manager — creates and updates unit sprites on the battle map.
 * Uses colored rectangle placeholders until sprite sheets are available.
 * Each unit gets a container with a body graphic + label text.
 *
 * When a unit has a `spriteSheet` field, the loader fetches the descriptor
 * asynchronously. The colored rectangle is shown immediately; once the sprite
 * sheet loads, a Sprite replaces the rectangle body.
 *
 * Movement tweens
 * ---------------
 * syncUnits() does NOT snap sprite positions. It sets `targetX/targetY` and,
 * if the target has changed, captures the current on-screen position as
 * `fromX/fromY` and resets `lerpT = 0`. The actual motion happens in
 * tickSprites(), called from the main Pixi ticker at 60fps, which advances
 * `lerpT` toward 1 and writes the eased interpolated position to the
 * container. Settled sprites (lerpT >= 1) cost one comparison per frame.
 *
 * tickSprites() also writes the count of still-moving sprites to
 * `transient.activeAnimCount` so _scheduleAiTurn can gate on it.
 *
 * Tweens and sprite-sheets are orthogonal: the tween moves
 * `container.position`, the sheet swaps `animatedSprite.texture`. During a
 * tween the walk pose is shown (frame 0); on settle, back to idle frame 0.
 */

import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { BattleState, UnitState, unitAlive } from "../engine/state";
import { TILE_SIZE } from "./pixiApp";
import { loadSpriteSheet } from "./spriteSheetLoader";
import type { AnimationStateName, LoadedSpriteSheet } from "./spriteSheetTypes";
import type { TransientState } from "../store/battleStore";

const TEAM_COLORS: Record<string, number> = {
  player: 0x4488ff,
  pc: 0x4488ff,      // Player characters
  party: 0x4488ff,   // Party members
  ally: 0x44ff88,    // Allies (green)
  enemy: 0xff4444,   // Enemies (red)
  neutral: 0xffaa22, // Neutral (orange)
};
const DEAD_COLOR = 0x555555;
const ACTIVE_OUTLINE = 0xffd700;   // Gold — whose turn it is
const SELECTED_OUTLINE = 0xffffff; // White — player-inspected unit
const UNIT_PADDING = 6;

/** Fixed tween duration in ms. Short and long moves take the same time;
 *  distance is absorbed by the easing curve, not the clock. */
const TWEEN_MS = 280;
/** Below this pixel delta a target change is treated as "already there"
 *  (guards against float drift re-arming the tween every syncUnits). */
const SETTLE_EPS = 0.5;

interface UnitSprite {
  container: Container;
  body: Graphics;
  label: Text;
  /** Thin HP bar above the unit body — track + fill drawn in one Graphics. */
  hpBar: Graphics;
  unitId: string;
  /** Optional pixel-art sprite (replaces body when loaded). */
  animatedSprite?: Sprite;
  /** Loaded sprite sheet data (null until async load completes). */
  spriteSheet?: LoadedSpriteSheet;
  /** Current animation state name. */
  currentAnimation?: AnimationStateName;
  /** Tween target (pixels, world space). Set by syncUnits(). */
  targetX: number;
  targetY: number;
  /** Tween origin — wherever the sprite was on screen when the target last changed. */
  fromX: number;
  fromY: number;
  /** 0 = tween just armed, 1 = settled. Advanced by tickSprites(). */
  lerpT: number;
}

const HP_BAR_W = TILE_SIZE - UNIT_PADDING * 2;
const HP_BAR_H = 4;
const HP_BAR_Y = 2;   // a couple of pixels below the top edge of the tile
const HP_TRACK_COLOR = 0x2a2a3a;

/** Same traffic-light scheme as the React PartyPanel HpBar. */
function hpColor(pct: number): number {
  if (pct < 0.25) return 0xe53935;
  if (pct < 0.50) return 0xfb8c00;
  return 0x43a047;
}

const _sprites = new Map<string, UnitSprite>();
/** Track which sprite sheet URLs are being loaded to avoid duplicate fetches. */
const _loadingSheets = new Set<string>();
let _parentLayer: Container | null = null;

function teamColor(team: string): number {
  return TEAM_COLORS[team] ?? 0x888888;
}

function createUnitSprite(unit: UnitState): UnitSprite {
  const container = new Container();
  container.label = `unit_${unit.unitId}`;

  const body = new Graphics();
  const hpBar = new Graphics();
  const label = new Text({
    text: unit.unitId.substring(0, 3).toUpperCase(),
    style: new TextStyle({ fontSize: 12, fill: 0xffffff, fontFamily: "monospace" }),
  });
  label.anchor.set(0.5, 0.5);
  label.position.set(TILE_SIZE / 2, TILE_SIZE / 2 + 2);

  container.addChild(body);
  container.addChild(label);
  container.addChild(hpBar);  // on top so it's never covered by the body outline

  // Tween state starts settled — syncUnits() snaps on first sight.
  const sprite: UnitSprite = {
    container, body, label, hpBar, unitId: unit.unitId,
    targetX: 0, targetY: 0, fromX: 0, fromY: 0, lerpT: 1,
  };

  // Kick off async sprite sheet loading if the unit has a spriteSheet path
  if (unit.spriteSheet && !_loadingSheets.has(unit.spriteSheet)) {
    _loadingSheets.add(unit.spriteSheet);
    loadSpriteSheet(unit.spriteSheet).then((loaded) => {
      if (loaded) {
        _applySpriteSheet(sprite, loaded);
      }
    });
  }

  return sprite;
}

/**
 * Apply a loaded sprite sheet to a unit sprite, replacing the colored
 * rectangle body with a pixel-art Sprite showing the first idle frame.
 */
function _applySpriteSheet(sprite: UnitSprite, sheet: LoadedSpriteSheet): void {
  sprite.spriteSheet = sheet;

  // Get the first frame of the idle animation (or frame 0 as fallback)
  const idleAnim = sheet.descriptor.animations.idle;
  const frameIndex = idleAnim ? idleAnim.frames[0] : 0;
  const texture = sheet.frames[frameIndex] as Texture;
  if (!texture) return;

  const pixelSprite = new Sprite(texture);
  // Scale to fit tile size
  pixelSprite.width = TILE_SIZE - UNIT_PADDING * 2;
  pixelSprite.height = TILE_SIZE - UNIT_PADDING * 2;
  pixelSprite.position.set(UNIT_PADDING, UNIT_PADDING);

  sprite.animatedSprite = pixelSprite;
  sprite.currentAnimation = "idle";

  // Add the sprite and hide the rectangle body
  sprite.container.addChildAt(pixelSprite, 1); // after body, before label
  sprite.body.visible = false;
}

/**
 * Set the animation state for a unit sprite.
 * Updates the displayed frame based on the animation definition.
 */
export function setUnitAnimation(unitId: string, animation: AnimationStateName): void {
  const sprite = _sprites.get(unitId);
  if (!sprite || !sprite.spriteSheet || !sprite.animatedSprite) return;
  if (sprite.currentAnimation === animation) return;

  const animDef = sprite.spriteSheet.descriptor.animations[animation];
  if (!animDef || animDef.frames.length === 0) return;

  sprite.currentAnimation = animation;
  const texture = sprite.spriteSheet.frames[animDef.frames[0]] as Texture;
  if (texture) {
    sprite.animatedSprite.texture = texture;
  }
}

function drawUnitBody(sprite: UnitSprite, unit: UnitState, selected: boolean, active: boolean): void {
  const alive = unitAlive(unit);
  const color = alive ? teamColor(unit.team) : DEAD_COLOR;
  const p = UNIT_PADDING;

  // Only draw the rectangle body if no sprite sheet is loaded
  if (!sprite.animatedSprite) {
    sprite.body.clear();
    sprite.body
      .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
      .fill(color);
  } else {
    sprite.body.clear();
    // Still draw outlines over the sprite
    sprite.animatedSprite.alpha = alive ? 1 : 0.3;
  }

  // Active turn unit gets a gold outline; selected-but-not-active gets white.
  if (active) {
    sprite.body.setStrokeStyle({ width: 3, color: ACTIVE_OUTLINE });
    sprite.body
      .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
      .stroke();
    sprite.body.visible = true;
  } else if (selected) {
    sprite.body.setStrokeStyle({ width: 2, color: SELECTED_OUTLINE });
    sprite.body
      .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
      .stroke();
    sprite.body.visible = true;
  } else if (sprite.animatedSprite) {
    // Hide body graphics when we have a sprite and no outline needed
    sprite.body.visible = false;
  }

  sprite.label.alpha = alive ? 1 : 0.4;
  // Hide label when sprite sheet is loaded (the art replaces the 3-letter ID)
  if (sprite.animatedSprite) {
    sprite.label.visible = false;
  }

  // HP bar — track + fill. Hidden on dead units (corpse clutter otherwise).
  sprite.hpBar.clear();
  if (alive) {
    const pct = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    const fillW = Math.max(1, Math.round(HP_BAR_W * pct));
    sprite.hpBar
      .rect(p, HP_BAR_Y, HP_BAR_W, HP_BAR_H)
      .fill(HP_TRACK_COLOR)
      .rect(p, HP_BAR_Y, fillW, HP_BAR_H)
      .fill(hpColor(pct));
  }
}

export function syncUnits(
  parent: Container,
  state: BattleState,
  selectedUnitId: string | null,
  activeUnitId: string | null,
): void {
  _parentLayer = parent;

  // Remove sprites for units no longer in state
  for (const [uid, sprite] of _sprites) {
    if (!(uid in state.units)) {
      parent.removeChild(sprite.container);
      sprite.container.destroy({ children: true });
      _sprites.delete(uid);
    }
  }

  // Add/update sprites for current units
  for (const unit of Object.values(state.units)) {
    let sprite = _sprites.get(unit.unitId);
    const isNew = !sprite;
    if (!sprite) {
      sprite = createUnitSprite(unit);
      parent.addChild(sprite.container);
      _sprites.set(unit.unitId, sprite);
    }

    // Position — set the tween target; tickSprites() drives the actual slide.
    // New sprites snap so they don't tween in from (0,0).
    const tx = unit.x * TILE_SIZE;
    const ty = unit.y * TILE_SIZE;
    if (isNew) {
      sprite.container.position.set(tx, ty);
      sprite.targetX = tx; sprite.targetY = ty;
      sprite.fromX   = tx; sprite.fromY   = ty;
      sprite.lerpT   = 1;
    } else if (
      Math.abs(tx - sprite.targetX) > SETTLE_EPS ||
      Math.abs(ty - sprite.targetY) > SETTLE_EPS
    ) {
      // Target moved — arm a new tween from wherever the sprite is right now.
      // Reading container.position (not fromX) means a mid-tween re-target
      // cuts the corner smoothly instead of rubber-banding to the old start.
      sprite.fromX   = sprite.container.position.x;
      sprite.fromY   = sprite.container.position.y;
      sprite.targetX = tx;
      sprite.targetY = ty;
      sprite.lerpT   = 0;
    }

    // Appearance — active (gold) takes visual priority over selected (white)
    const active = unit.unitId === activeUnitId;
    const selected = unit.unitId === selectedUnitId;
    drawUnitBody(sprite, unit, selected, active);

    // Dead units go slightly transparent and behind others
    sprite.container.alpha = unitAlive(unit) ? 1 : 0.5;
    sprite.container.zIndex = unitAlive(unit) ? unit.y * 100 + 1 : 0;
  }

  // Sort by zIndex for proper overlap
  parent.sortChildren();
}

/** Quadratic ease-out: fast launch, gentle arrival. Matches the float-text
 *  easing in effectRenderer so the game has one consistent motion feel. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Advance all active sprite tweens by `deltaMS` and write the count of
 * still-moving sprites into `transient.activeAnimCount`.
 *
 * Called from the main Pixi ticker (see App.tsx). Mutates the transient
 * slice directly — no React re-render, no allocation.
 *
 * Walk pose: swaps to 'walk' frame-0 while lerpT<1, back to 'idle' on land.
 * setUnitAnimation no-ops if the sheet isn't loaded or the anim is absent,
 * and early-returns on `currentAnimation === target`, so the per-frame call
 * is cheap (one comparison per moving sprite, zero texture swaps).
 */
export function tickSprites(deltaMS: number, transient: TransientState): void {
  let moving = 0;
  for (const sprite of _sprites.values()) {
    if (sprite.lerpT >= 1) continue;

    sprite.lerpT = Math.min(1, sprite.lerpT + deltaMS / TWEEN_MS);
    const e = easeOut(sprite.lerpT);
    sprite.container.position.set(
      sprite.fromX + (sprite.targetX - sprite.fromX) * e,
      sprite.fromY + (sprite.targetY - sprite.fromY) * e,
    );

    if (sprite.lerpT >= 1) {
      // Exact landing — kill any accumulated float error.
      sprite.container.position.set(sprite.targetX, sprite.targetY);
      setUnitAnimation(sprite.unitId, "idle");
    } else {
      moving++;
      setUnitAnimation(sprite.unitId, "walk");
    }
  }
  transient.activeAnimCount = moving;
}

/**
 * Force every sprite to its current target instantly. Called on fresh battle
 * load: Play Again reuses unit IDs, so sprites survive the reload — without
 * this, corpses tween back to their spawn points.
 */
export function snapAllSprites(): void {
  for (const sprite of _sprites.values()) {
    sprite.container.position.set(sprite.targetX, sprite.targetY);
    sprite.fromX = sprite.targetX;
    sprite.fromY = sprite.targetY;
    sprite.lerpT = 1;
    // tickSprites won't touch a lerpT>=1 sprite again, so if it was mid-walk
    // (Play Again during a tween) clear the pose now. No-ops on placeholders.
    setUnitAnimation(sprite.unitId, "idle");
  }
}

export function clearUnits(): void {
  if (_parentLayer) {
    for (const sprite of _sprites.values()) {
      _parentLayer.removeChild(sprite.container);
      sprite.container.destroy({ children: true });
    }
  }
  _sprites.clear();
  _loadingSheets.clear();
}
