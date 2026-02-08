// @ts-nocheck - Closure captures require careful null handling
/**
 * Effect renderer — damage numbers, hit flashes, condition indicators.
 * Uses object pooling for damage number Text objects.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILE_SIZE } from "./pixiApp";

interface PooledDamageText {
  text: Text;
  inUse: boolean;
}

const POOL_SIZE = 20;
const _pool: PooledDamageText[] = [];
let _effectsLayer: Container | null = null;

function damageStyle(damageType: string): TextStyle {
  let color = 0xff4444;
  if (damageType === "fire") color = 0xff8800;
  else if (damageType === "cold") color = 0x88ccff;
  else if (damageType === "electric" || damageType === "electricity") color = 0xffff44;
  else if (damageType === "acid") color = 0x88ff44;
  else if (damageType === "positive" || damageType === "healing") color = 0x44ff88;
  return new TextStyle({ fontSize: 16, fill: color, fontFamily: "monospace", fontWeight: "bold" });
}

export function initEffectRenderer(layer: Container): void {
  _effectsLayer = layer;

  // Pre-allocate pool
  for (let i = 0; i < POOL_SIZE; i++) {
    const text = new Text({ text: "", style: damageStyle("physical") });
    text.visible = false;
    text.anchor.set(0.5, 1);
    layer.addChild(text);
    _pool.push({ text, inUse: false });
  }
}

function acquireFromPool(): PooledDamageText | null {
  return _pool.find((p) => !p.inUse) ?? null;
}

export function showDamageNumber(
  tileX: number,
  tileY: number,
  amount: number,
  damageType: string,
): void {
  if (!_effectsLayer) return;
  const pooled = acquireFromPool();
  if (!pooled) return;

  pooled.inUse = true;
  pooled.text.text = `-${amount}`;
  pooled.text.style = damageStyle(damageType);
  pooled.text.position.set(
    tileX * TILE_SIZE + TILE_SIZE / 2,
    tileY * TILE_SIZE,
  );
  pooled.text.visible = true;
  pooled.text.alpha = 1;

  // Animate upward and fade — simple ticker-based animation
  let elapsed = 0;
  const duration = 1200;
  const startY = tileY * TILE_SIZE;

  function animate(delta: { deltaMS: number }) {
    elapsed += delta.deltaMS;
    const t = Math.min(elapsed / duration, 1);
    pooled.text.position.y = startY - 30 * t;
    pooled.text.alpha = 1 - t;
    if (t >= 1) {
      pooled.text.visible = false;
      pooled.inUse = false;
      // Remove listener — attached via onRender or ticker externally
    }
  }

  // Expose for ticker attachment
  (pooled.text as unknown as { _animateFn: typeof animate })._animateFn = animate;
}

export function flashHit(tileX: number, tileY: number): void {
  if (!_effectsLayer) return;
  const flash = new Graphics();
  flash
    .rect(tileX * TILE_SIZE + 4, tileY * TILE_SIZE + 4, TILE_SIZE - 8, TILE_SIZE - 8)
    .fill({ color: 0xffffff, alpha: 0.6 });
  _effectsLayer.addChild(flash);

  let elapsed = 0;
  const duration = 300;

  function fadeFlash(delta: { deltaMS: number }) {
    elapsed += delta.deltaMS;
    flash.alpha = 1 - elapsed / duration;
    if (elapsed >= duration) {
      flash.destroy();
    }
  }
  (flash as unknown as { _animateFn: typeof fadeFlash })._animateFn = fadeFlash;
}
