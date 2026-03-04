/**
 * Range and target highlight overlay for the PixiJS canvas.
 *
 * Renders semi-transparent tile fills between the map and unit layers to
 * communicate reachable movement tiles, valid strike targets, and spell ranges.
 */

import { Container, Graphics } from "pixi.js";
import { BattleState, unitAlive } from "../engine/state";
import { hasLineOfSight } from "../grid/los";
import { hasTileLineOfEffect } from "../grid/loe";
import { radiusPoints } from "../grid/areas";
import { inBounds } from "../grid/map";
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
// Area footprint — red-orange. Noticeably hotter than STRIKE_FILL so the
// player doesn't read a big blast diamond as a strike range.
const AREA_FILL     = 0xff5522;
const AREA_ALPHA    = 0.32;
// Tiles in the geometric radius but behind a wall — the reducer's LOE filter
// will exclude them, so draw them muted instead of hiding them entirely. The
// player still learns "this wall is saving that guy" from the visual.
const AREA_SHADOW_ALPHA = 0.08;
// Path preview — white, high contrast so it reads over blue/amber tiles.
// Fill alpha near 1, stroke black: the chevrons are tiny and sit on top of
// translucent tile fills; without the stroke they mush into the background.
const PATH_COLOR   = 0xffffff;
const PATH_STROKE  = 0x000000;
const PATH_ALPHA   = 0.95;
const CHEVRON_R    = 7;            // half-width of a chevron triangle
const DEST_RING_R  = TILE_SIZE / 2 - 10;

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
/** Area footprint — separate Graphics so the hover redraw doesn't wipe
 *  whatever _graphics is showing underneath (usually nothing for area mode,
 *  but keeping the layers independent means we never have to think about it). */
let _areaGraphics: Graphics | null = null;
/** Separate Graphics for the path preview so showPathPreview() can redraw
 *  on every mouse-move without wiping the blue reachable-tile fills. Added
 *  to the layer last → draws on top (Pixi children render in insertion order
 *  when sortableChildren is off). Path and area never coexist (move mode vs
 *  spell mode) so the z-order between them is academic. */
let _pathGraphics: Graphics | null = null;

export function initRangeOverlay(layer: Container): void {
  // Guard against re-initialisation (e.g. hot-reload): clean up the old
  // Graphics objects before creating new ones.
  if (_overlay) {
    if (_graphics)     { _overlay.removeChild(_graphics);     _graphics.destroy();     _graphics = null; }
    if (_areaGraphics) { _overlay.removeChild(_areaGraphics); _areaGraphics.destroy(); _areaGraphics = null; }
    if (_pathGraphics) { _overlay.removeChild(_pathGraphics); _pathGraphics.destroy(); _pathGraphics = null; }
  }
  _overlay = layer;
  _graphics = new Graphics();
  _areaGraphics = new Graphics();
  _pathGraphics = new Graphics();
  _overlay.addChild(_graphics);
  _overlay.addChild(_areaGraphics);
  _overlay.addChild(_pathGraphics);
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

/**
 * Highlight enemy units as strike targets. Only enemies within melee reach
 * (Chebyshev distance ≤ actor.reach) are shown — mirrors the reducer's reach
 * check so the overlay never advertises an illegal target.
 */
export function showStrikeTargets(state: BattleState, actorId: string): void {
  if (!_graphics) return;
  _graphics.clear();
  const actor = state.units[actorId];
  if (!actor) return;
  const reach = actor.reach ?? 1;
  for (const unit of Object.values(state.units)) {
    if (unit.unitId === actorId) continue;
    if (!unitAlive(unit)) continue;
    if (unit.team === actor.team) continue;
    const dist = Math.max(Math.abs(unit.x - actor.x), Math.abs(unit.y - actor.y));
    if (dist > reach) continue;
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
  _areaGraphics?.clear();
  _pathGraphics?.clear();
}

// ---------------------------------------------------------------------------
// Area footprint — blast-radius preview for burst spells.
//
// The tile set here MUST match what the reducer's area_save_damage handler
// actually hits. That handler does:
//   1. radiusPoints(center, tilesFromFeet(radiusFeet))  — Manhattan diamond
//   2. filter by hasTileLineOfEffect from the center
//
// We mirror both steps exactly. The feet→tiles formula is duplicated from
// reducer.ts (its copy is module-private); if these ever drift the player
// will see a red tile the spell doesn't touch, or vice versa — the
// regression-hash suite won't catch it because rendering isn't hashed.
//
// Tiles that fall outside the LOE filter are drawn very faint instead of
// hidden. That way a wall in the blast is legible: the bright red stops at
// the wall, faint red continues on the far side.
// ---------------------------------------------------------------------------

/** PF2e 5ft grid. Duplicate of reducer.ts:tilesFromFeet — see block comment. */
function tilesFromFeet(feet: number): number {
  return Math.max(1, Math.floor((feet + 4) / 5));
}

export function showAreaFootprint(
  cx: number,
  cy: number,
  radiusFeet: number,
  state: BattleState,
): void {
  if (!_areaGraphics) return;
  _areaGraphics.clear();

  const radiusTiles = tilesFromFeet(radiusFeet);
  for (const [tx, ty] of radiusPoints(cx, cy, radiusTiles)) {
    // radiusPoints doesn't clip to the map — hasTileLineOfEffect does (it
    // returns false for out-of-bounds targets) but checking inBounds first
    // saves the Bresenham walk for tiles we know we won't draw.
    if (!inBounds(state, tx, ty)) continue;
    const hit = hasTileLineOfEffect(state, cx, cy, tx, ty);
    drawTile(_areaGraphics, tx, ty, AREA_FILL, hit ? AREA_ALPHA : AREA_SHADOW_ALPHA);
  }
}

/** Clear just the area footprint, leaving whatever _graphics has up.
 *  Called when the mouse leaves the map but area-targeting mode stays active. */
export function clearAreaFootprint(): void {
  _areaGraphics?.clear();
}

// ---------------------------------------------------------------------------
// Path preview — chevrons at waypoints, ring at destination.
//
// `path` is in travel order: [0]=start (unit's tile), [last]=destination.
// We skip index 0 — the unit sprite is already there. Every intermediate tile
// gets a chevron pointing toward the NEXT step (so the player reads "go this
// way", not "came from here"). The destination gets an open ring instead of
// a chevron so it's unambiguous where the unit will land.
//
// Chevron geometry: solid triangle with tip along (dx,dy) and two barbs
// swept back along the perpendicular. Movement is cardinal-only (see DIRS
// in movement.ts) so (dx,dy) is always a unit basis vector — no trig needed.
// ---------------------------------------------------------------------------

function drawChevron(g: Graphics, cx: number, cy: number, dx: number, dy: number): void {
  // Perpendicular to travel direction, for barb spread.
  const px = -dy, py = dx;
  const r = CHEVRON_R;
  g.poly([
    cx + dx * r,          cy + dy * r,           // tip
    cx - dx * r + px * r, cy - dy * r + py * r,  // barb
    cx - dx * r - px * r, cy - dy * r - py * r,  // barb
  ])
    .fill({ color: PATH_COLOR, alpha: PATH_ALPHA })
    .stroke({ color: PATH_STROKE, alpha: 0.8, width: 1 });
}

export function showPathPreview(path: Array<[number, number]>): void {
  if (!_pathGraphics) return;
  _pathGraphics.clear();
  if (path.length < 2) return;

  const last = path.length - 1;

  // Waypoint chevrons — everything between the unit and the landing tile.
  for (let i = 1; i < last; i++) {
    const [x, y] = path[i];
    const [nx, ny] = path[i + 1];
    const cx = x * TILE_SIZE + TILE_SIZE / 2;
    const cy = y * TILE_SIZE + TILE_SIZE / 2;
    drawChevron(_pathGraphics, cx, cy, nx - x, ny - y);
  }

  // Destination ring — black underlayer first, white on top. Draw order is
  // paint order in Pixi, so the wider stroke has to go down first.
  const [dx, dy] = path[last];
  const rcx = dx * TILE_SIZE + TILE_SIZE / 2;
  const rcy = dy * TILE_SIZE + TILE_SIZE / 2;
  _pathGraphics
    .circle(rcx, rcy, DEST_RING_R)
    .stroke({ color: PATH_STROKE, alpha: 0.6, width: 4 })
    .circle(rcx, rcy, DEST_RING_R)
    .stroke({ color: PATH_COLOR, alpha: PATH_ALPHA, width: 2 });
}

/** Clear just the path preview, leaving the range tiles up. Called when the
 *  mouse moves off a reachable tile but move mode is still active. */
export function clearPathPreview(): void {
  _pathGraphics?.clear();
}
