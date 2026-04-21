/**
 * Range and target highlight overlay for the PixiJS canvas.
 *
 * Renders semi-transparent tile fills between the map and unit layers to
 * communicate reachable movement tiles, valid strike targets, and spell ranges.
 */

import { Container, Graphics } from "pixi.js";
import { BattleState, unitAlive, resolveWeapon } from "../engine/state";
import { hasLineOfSight } from "../grid/los";
import { hasTileLineOfEffect } from "../grid/loe";
import { radiusPoints } from "../grid/areas";
import { inBounds, tilesFromFeet } from "../grid/map";
import { thrownRange } from "../engine/traits";
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
const RANGED_FILL = 0xff8844;     // orange — ranged strike targets
const RANGED_ALPHA = 0.35;
const ABILITY_FILL = 0xaa44ff;
const ABILITY_ALPHA = 0.30;
const BORDER_ALPHA = 0.55;
// Area footprint — red-orange. Hotter than STRIKE_FILL so a big blast
// diamond doesn't read as a strike range.
const AREA_FILL         = 0xff5522;
const AREA_ALPHA        = 0.32;
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
// Locked (confirmed) path — green tint signals "click again to commit."
const LOCKED_PATH_COLOR  = 0x44ff88;
const LOCKED_PATH_STROKE = 0x005522;
const LOCKED_PATH_ALPHA  = 1.0;
const CHEVRON_R    = 7;                    // half-width of a chevron triangle
const DEST_RING_R  = TILE_SIZE / 2 - 10;
// AoO threat markers — red ring around units that can react to the locked path.
const THREAT_COLOR = 0xff2222;
const THREAT_ALPHA = 0.9;

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
 *  whatever _graphics is showing (usually nothing in area mode, but keeping
 *  layers independent means we never have to think about it). */
let _areaGraphics: Graphics | null = null;
/** Separate Graphics for the path preview so showPathPreview() can redraw
 *  on every mouse-move without wiping the blue reachable-tile fills. Added
 *  last → draws on top. Path and area never coexist (move mode vs spell
 *  mode) so the z-order between them is academic. */
let _pathGraphics: Graphics | null = null;
/** AoO threat markers — rendered on top of everything so they read clearly
 *  over the green locked path. Cleared whenever the path is unlocked. */
let _threatGraphics: Graphics | null = null;

export function initRangeOverlay(layer: Container): void {
  // Guard against re-initialisation (e.g. hot-reload): clean up the old
  // Graphics objects before creating new ones.
  if (_overlay) {
    if (_graphics)      { _overlay.removeChild(_graphics);      _graphics.destroy();      _graphics = null; }
    if (_areaGraphics)  { _overlay.removeChild(_areaGraphics);  _areaGraphics.destroy();  _areaGraphics = null; }
    if (_pathGraphics)  { _overlay.removeChild(_pathGraphics);  _pathGraphics.destroy();  _pathGraphics = null; }
    if (_threatGraphics){ _overlay.removeChild(_threatGraphics);_threatGraphics.destroy();_threatGraphics = null; }
  }
  _overlay = layer;
  _graphics = new Graphics();
  _areaGraphics = new Graphics();
  _pathGraphics = new Graphics();
  _threatGraphics = new Graphics();
  _overlay.addChild(_graphics);
  _overlay.addChild(_areaGraphics);
  _overlay.addChild(_pathGraphics);
  _overlay.addChild(_threatGraphics);
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
 * Highlight enemy units as strike targets. Supports both melee and ranged weapons.
 * When `weaponIndex` is provided, uses that weapon's range/reach; otherwise uses
 * the first weapon or flat fields. Melee targets shown in red, ranged in orange.
 */
export function showStrikeTargets(state: BattleState, actorId: string, weaponIndex?: number): void {
  if (!_graphics) return;
  _graphics.clear();
  const actor = state.units[actorId];
  if (!actor) return;

  let weapon;
  try {
    weapon = resolveWeapon(actor, weaponIndex);
  } catch {
    return;
  }

  // Don't highlight targets if weapon has no ammo
  if (weapon.ammo != null) {
    const remaining = actor.weaponAmmo?.[weaponIndex ?? 0] ?? 0;
    if (remaining <= 0) return;
  }

  for (const unit of Object.values(state.units)) {
    if (unit.unitId === actorId) continue;
    if (!unitAlive(unit)) continue;
    if (unit.team === actor.team) continue;
    const dist = Math.max(Math.abs(unit.x - actor.x), Math.abs(unit.y - actor.y));
    if (!hasLineOfSight(state, actor, unit)) continue;

    if (weapon.type === "melee") {
      const reach = weapon.reach ?? 1;
      const thrown = thrownRange(weapon);
      if (dist <= reach) {
        drawTile(_graphics, unit.x, unit.y, STRIKE_FILL, STRIKE_ALPHA);
      } else if (thrown !== null && dist <= thrown) {
        drawTile(_graphics, unit.x, unit.y, RANGED_FILL, RANGED_ALPHA);
      }
      // else: out of reach/thrown range — skip
    } else {
      const maxRange = weapon.maxRange ?? (weapon.rangeIncrement ?? 6) * 6;
      if (dist < 1 || dist > maxRange) continue;
      drawTile(_graphics, unit.x, unit.y, RANGED_FILL, RANGED_ALPHA);
    }
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

/** Remove all highlights (range fills, area footprint, path preview, threat markers). */
export function clearRangeOverlay(): void {
  _graphics?.clear();
  _areaGraphics?.clear();
  _pathGraphics?.clear();
  _threatGraphics?.clear();
}

// ---------------------------------------------------------------------------
// Area footprint — blast-radius preview for burst spells.
//
// The tile set here MUST match what the reducer's area_save_damage handler
// actually hits. That handler does:
//   1. radiusPoints(center, tilesFromFeet(radiusFeet))  — Manhattan diamond
//   2. filter by hasTileLineOfEffect from the center
//
// We mirror both steps exactly. Both import tilesFromFeet from grid/map.ts.
//
// Tiles that fail the LOE filter are drawn very faint instead of hidden.
// That way a wall in the blast is legible: bright red stops at the wall,
// faint red continues on the far side.
// ---------------------------------------------------------------------------

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

/** Clear just the area footprint. Called when the mouse leaves the map
 *  but area-targeting mode stays active. */
export function clearAreaFootprint(): void {
  _areaGraphics?.clear();
}

// ---------------------------------------------------------------------------
// Path preview — chevrons at waypoints, ring at destination.
//
// `path` is in travel order: [0]=start (unit's tile), [last]=destination.
// Index 0 is skipped — the unit sprite is already there. Every intermediate
// tile gets a chevron pointing toward the NEXT step (so the player reads
// "go this way", not "came from here"). The destination gets an open ring
// instead of a chevron so it's unambiguous where the unit will land.
//
// Movement is 8-connected: (dx,dy) may be a diagonal like (1,1). The chevron
// geometry normalizes the direction so diagonal and orthogonal chevrons draw
// at the same size instead of diagonals coming out √2× larger.
// ---------------------------------------------------------------------------

function drawChevron(
  g: Graphics,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  fill: number,
  fillAlpha: number,
  stroke: number,
): void {
  // Normalize so diagonal chevrons don't draw √2× larger than orthogonal.
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  // Perpendicular to travel direction, for barb spread.
  const px = -uy, py = ux;
  const r = CHEVRON_R;
  g.poly([
    cx + ux * r,          cy + uy * r,           // tip
    cx - ux * r + px * r, cy - uy * r + py * r,  // barb
    cx - ux * r - px * r, cy - uy * r - py * r,  // barb
  ])
    .fill({ color: fill, alpha: fillAlpha })
    .stroke({ color: stroke, alpha: 0.8, width: 1 });
}

/**
 * Draw the path preview. When `locked` is true the chevrons and ring switch
 * to a green "confirmed" palette so the player sees a clear visual difference
 * between "hovering" and "click again to commit."
 */
export function showPathPreview(path: Array<[number, number]>, locked = false): void {
  if (!_pathGraphics) return;
  _pathGraphics.clear();
  if (path.length < 2) return;

  const color  = locked ? LOCKED_PATH_COLOR  : PATH_COLOR;
  const stroke = locked ? LOCKED_PATH_STROKE : PATH_STROKE;
  const alpha  = locked ? LOCKED_PATH_ALPHA  : PATH_ALPHA;
  const last = path.length - 1;

  // Waypoint chevrons — everything between the unit and the landing tile.
  for (let i = 1; i < last; i++) {
    const [x, y] = path[i];
    const [nx, ny] = path[i + 1];
    const cx = x * TILE_SIZE + TILE_SIZE / 2;
    const cy = y * TILE_SIZE + TILE_SIZE / 2;
    drawChevron(_pathGraphics, cx, cy, nx - x, ny - y, color, alpha, stroke);
  }

  // Destination ring — dark underlayer first, colour on top.
  const [dx, dy] = path[last];
  const rcx = dx * TILE_SIZE + TILE_SIZE / 2;
  const rcy = dy * TILE_SIZE + TILE_SIZE / 2;
  _pathGraphics
    .circle(rcx, rcy, DEST_RING_R)
    .stroke({ color: stroke, alpha: 0.6, width: 4 })
    .circle(rcx, rcy, DEST_RING_R)
    .stroke({ color: color, alpha: alpha, width: 2 });
}

/** Clear just the path preview, leaving the range tiles up. Called when the
 *  mouse moves off a reachable tile but move mode is still active. */
export function clearPathPreview(): void {
  _pathGraphics?.clear();
}

// ---------------------------------------------------------------------------
// AoO threat markers — red rings on enemies that can react to a locked path.
//
// showThreatMarkers draws a ring slightly larger than DEST_RING_R around each
// threatening unit, making it unambiguous which enemies can punish the move
// without cluttering the canvas when there are no threats.
// ---------------------------------------------------------------------------

/**
 * Draw a red threat ring on each unit in `threatUnitIds`.
 * Call whenever a path is locked; clear when it is unlocked or confirmed.
 */
export function showThreatMarkers(threatUnitIds: Set<string>, state: BattleState): void {
  if (!_threatGraphics) return;
  _threatGraphics.clear();
  for (const unitId of threatUnitIds) {
    const unit = state.units[unitId];
    if (!unit) continue;
    const cx = unit.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = unit.y * TILE_SIZE + TILE_SIZE / 2;
    // Outer ring — slightly larger than the destination ring so it frames the
    // unit sprite without overlapping the path chevrons at the same tile.
    _threatGraphics
      .circle(cx, cy, DEST_RING_R + 5)
      .stroke({ color: THREAT_COLOR, alpha: THREAT_ALPHA, width: 3 });
  }
}

/** Clear just the threat markers. Called when the path is unlocked. */
export function clearThreatMarkers(): void {
  _threatGraphics?.clear();
}
