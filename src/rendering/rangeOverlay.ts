/**
 * Range and target highlight overlay for the PixiJS canvas.
 *
 * Renders semi-transparent tile fills between the map and unit layers to
 * communicate reachable movement tiles, valid strike targets, and spell ranges.
 */

import { Container, Graphics } from "pixi.js";
import { BattleState, unitAlive } from "../engine/state";
import { hasLineOfSight } from "../grid/los";
import { TILE_SIZE } from "./pixiApp";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const MOVE_FILL = 0x4488ff;
const MOVE_ALPHA = 0.30;
const DIFFICULT_FILL = 0xffaa22;   // amber — tile costs >1 movement to enter
const DIFFICULT_ALPHA = 0.35;
const STRIKE_FILL = 0xff4444;
const STRIKE_ALPHA = 0.35;
const ABILITY_FILL = 0xaa44ff;
const ABILITY_ALPHA = 0.30;
const BORDER_ALPHA = 0.55;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function drawTile(
  g: Graphics,
  x: number,
  y: number,
  fill: number,
  fillAlpha: number,
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  g.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  g.fill({ color: fill, alpha: fillAlpha });
  g.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  g.stroke({ color: fill, alpha: BORDER_ALPHA, width: 1.5 });
}

function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _overlay: Container | null = null;
let _graphics: Graphics | null = null;

export function initRangeOverlay(layer: Container): void {
  // Guard against re-initialisation (e.g. hot-reload): clean up the old
  // Graphics object before creating a new one.
  if (_graphics && _overlay) {
    _overlay.removeChild(_graphics);
    _graphics.destroy();
    _graphics = null;
  }
  _overlay = layer;
  _graphics = new Graphics();
  _overlay.addChild(_graphics);
}

/**
 * Highlight all tiles in `tiles` (Set of "x,y" keys) as movement-reachable.
 * Tiles with moveCost > 1 are shown in amber to indicate difficult terrain.
 */
export function showMovementRange(tiles: Set<string>, state?: BattleState): void {
  if (!_graphics) return;
  _graphics.clear();
  for (const key of tiles) {
    const [x, y] = parseTileKey(key);
    const cost = state?.battleMap.moveCost?.[key] ?? 1;
    const fill = cost > 1 ? DIFFICULT_FILL : MOVE_FILL;
    const alpha = cost > 1 ? DIFFICULT_ALPHA : MOVE_ALPHA;
    drawTile(_graphics, x, y, fill, alpha);
  }
}

/** Highlight enemy units as strike targets. */
export function showStrikeTargets(state: BattleState, actorId: string): void {
  if (!_graphics) return;
  _graphics.clear();
  const actor = state.units[actorId];
  if (!actor) return;
  for (const unit of Object.values(state.units)) {
    if (unit.unitId === actorId) continue;
    if (!unitAlive(unit)) continue;
    if (unit.team === actor.team) continue;
    if (!hasLineOfSight(state, actor, unit)) continue;
    drawTile(_graphics, unit.x, unit.y, STRIKE_FILL, STRIKE_ALPHA);
  }
}

/** Highlight all alive enemy units as ability targets. */
export function showAbilityTargets(state: BattleState, actorId: string): void {
  if (!_graphics) return;
  _graphics.clear();
  const actor = state.units[actorId];
  if (!actor) return;
  for (const unit of Object.values(state.units)) {
    if (unit.unitId === actorId) continue;
    if (!unitAlive(unit)) continue;
    if (unit.team === actor.team) continue;
    drawTile(_graphics, unit.x, unit.y, ABILITY_FILL, ABILITY_ALPHA);
  }
}

/** Highlight all alive allied units (for support abilities). */
export function showAllyTargets(state: BattleState, actorId: string): void {
  if (!_graphics) return;
  _graphics.clear();
  const actor = state.units[actorId];
  if (!actor) return;
  for (const unit of Object.values(state.units)) {
    if (!unitAlive(unit)) continue;
    if (unit.team !== actor.team) continue;
    drawTile(_graphics, unit.x, unit.y, MOVE_FILL, MOVE_ALPHA);
  }
}

/** Remove all highlights. */
export function clearRangeOverlay(): void {
  _graphics?.clear();
}
