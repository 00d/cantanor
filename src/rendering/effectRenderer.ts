/**
 * Effect renderer — damage numbers, hit flashes, miss/heal text.
 *
 * Owns its own ticker update loop: active animations are stepped each frame
 * via a single shared `tickEffects()` callback. No per-animation Ticker
 * listeners, no property hacks — each animation is a plain data struct that
 * the tick function advances and reclaims.
 *
 * The `processAnimationQueue()` entry point drains the Zustand store's
 * transient animation queue and converts each logical BattleAnimation into a
 * visual effect. App.tsx calls it from the main game ticker.
 */

import { Container, Graphics, Text, TextStyle, Ticker } from "pixi.js";
import { TILE_SIZE } from "./pixiApp";
import { BattleState } from "../engine/state";
import type { BattleAnimation } from "../store/battleStore";

// ---------------------------------------------------------------------------
// Internal animation records
// ---------------------------------------------------------------------------

interface FloatTextAnim {
  kind: "float_text";
  display: Text;
  elapsed: number;
  duration: number;
  startY: number;
  rise: number;   // pixels to rise over duration
}

interface FlashAnim {
  kind: "flash";
  display: Graphics;
  elapsed: number;
  duration: number;
}

type ActiveAnim = FloatTextAnim | FlashAnim;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const POOL_SIZE = 24;
const _textPool: Text[] = [];
const _active: ActiveAnim[] = [];
let _layer: Container | null = null;
let _tickerAttached = false;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const DAMAGE_COLORS: Record<string, number> = {
  physical: 0xff5555,
  slashing: 0xff5555,
  piercing: 0xff5555,
  bludgeoning: 0xff5555,
  fire: 0xff8822,
  cold: 0x88ccff,
  electricity: 0xffee44,
  electric: 0xffee44,
  acid: 0x88ff44,
  poison: 0x66cc44,
  mental: 0xcc88ff,
  force: 0xffaaff,
  positive: 0x66ffaa,
  negative: 0xaa66ff,
  untyped: 0xeeeeee,
};
const HEAL_COLOR = 0x66ff88;
const MISS_COLOR = 0x999999;

function makeStyle(color: number, fontSize = 18): TextStyle {
  return new TextStyle({
    fontFamily: "monospace",
    fontSize,
    fontWeight: "bold",
    fill: color,
    stroke: { color: 0x000000, width: 3 },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initEffectRenderer(layer: Container): void {
  // Re-init guard (hot reload)
  if (_layer) clearEffectRenderer();
  _layer = layer;

  for (let i = 0; i < POOL_SIZE; i++) {
    const t = new Text({ text: "", style: makeStyle(0xffffff) });
    t.visible = false;
    t.anchor.set(0.5, 1);
    layer.addChild(t);
    _textPool.push(t);
  }

  if (!_tickerAttached) {
    Ticker.shared.add(tickEffects);
    _tickerAttached = true;
  }
}

export function clearEffectRenderer(): void {
  // Return all in-flight animations to idle without destroying pool
  for (const anim of _active) {
    if (anim.kind === "float_text") {
      anim.display.visible = false;
    } else {
      anim.display.destroy();
    }
  }
  _active.length = 0;
  for (const t of _textPool) t.visible = false;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

function acquireText(): Text | null {
  for (const t of _textPool) {
    if (!t.visible) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ticker — steps every active animation, reclaims finished ones.
// Iterates backward so splice() during the loop is safe.
// ---------------------------------------------------------------------------

function tickEffects(ticker: Ticker): void {
  const dt = ticker.deltaMS;
  for (let i = _active.length - 1; i >= 0; i--) {
    const anim = _active[i];
    anim.elapsed += dt;
    const t = Math.min(1, anim.elapsed / anim.duration);

    if (anim.kind === "float_text") {
      // Ease-out: fast rise, slow finish
      const eased = 1 - (1 - t) * (1 - t);
      anim.display.position.y = anim.startY - anim.rise * eased;
      anim.display.alpha = 1 - t;
    } else {
      anim.display.alpha = 0.7 * (1 - t);
    }

    if (t >= 1) {
      if (anim.kind === "float_text") {
        anim.display.visible = false;
      } else {
        anim.display.destroy();
      }
      _active.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

function spawnFloatText(
  tileX: number,
  tileY: number,
  text: string,
  color: number,
  rise = 36,
  duration = 900,
): void {
  if (!_layer) return;
  const display = acquireText();
  if (!display) return;

  display.text = text;
  display.style = makeStyle(color);
  const startY = tileY * TILE_SIZE + 8;
  display.position.set(tileX * TILE_SIZE + TILE_SIZE / 2, startY);
  display.alpha = 1;
  display.visible = true;

  _active.push({
    kind: "float_text",
    display,
    elapsed: 0,
    duration,
    startY,
    rise,
  });
}

function spawnFlash(tileX: number, tileY: number, color: number): void {
  if (!_layer) return;
  const g = new Graphics();
  g.rect(tileX * TILE_SIZE + 3, tileY * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  g.fill({ color, alpha: 0.7 });
  _layer.addChild(g);
  _active.push({ kind: "flash", display: g, elapsed: 0, duration: 260 });
}

// ---------------------------------------------------------------------------
// Public spawn API — used by processAnimationQueue and directly if needed.
// ---------------------------------------------------------------------------

export function showDamageNumber(
  tileX: number,
  tileY: number,
  amount: number,
  damageType: string,
): void {
  const color = DAMAGE_COLORS[damageType] ?? DAMAGE_COLORS.physical;
  spawnFlash(tileX, tileY, 0xffffff);
  spawnFloatText(tileX, tileY, `-${amount}`, color);
}

export function showHealNumber(tileX: number, tileY: number, amount: number): void {
  spawnFloatText(tileX, tileY, `+${amount}`, HEAL_COLOR, 28, 800);
}

export function showMiss(tileX: number, tileY: number): void {
  spawnFloatText(tileX, tileY, "miss", MISS_COLOR, 20, 700);
}

// ---------------------------------------------------------------------------
// Queue drain — called from the main game ticker.
// Looks up each target unit's current tile in the provided battle snapshot
// and spawns the corresponding visual.
// ---------------------------------------------------------------------------

export function processAnimationQueue(
  queue: BattleAnimation[],
  battle: BattleState,
): void {
  if (queue.length === 0) return;
  // Drain destructively — the queue lives in transient (non-reactive) store
  // state, so mutating it here is safe and avoids re-allocation each tick.
  while (queue.length > 0) {
    const anim = queue.shift()!;
    const unit = battle.units[anim.unitId];
    if (!unit) continue;

    if (anim.type === "damage") {
      showDamageNumber(unit.x, unit.y, anim.amount, anim.damageType);
    } else if (anim.type === "heal") {
      showHealNumber(unit.x, unit.y, anim.amount);
    } else if (anim.type === "miss") {
      showMiss(unit.x, unit.y);
    }
    // "move" animations are handled implicitly by syncUnits() snapping the
    // sprite; a future slide-tween would go here.
  }
}
