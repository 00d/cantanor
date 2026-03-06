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
import { radiusPoints, conePoints, lineAimPoints } from "../grid/areas";
import { inBounds } from "../grid/map";
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
// Area footprint — red-orange. Noticeably hotter than STRIKE_FILL so the
// player doesn't read a big blast diamond as a melee range. Dimmer than
// RANGED_FILL so ranged chips punching through the blast still read.
const AREA_FILL         = 0xff5522;
const AREA_ALPHA        = 0.32;
// Tiles in the geometric radius but behind a wall — the reducer's LOE filter
// will exclude them, so draw them faint instead of hiding them entirely. The
// player still learns "this wall is saving that guy" from the visual.
const AREA_SHADOW_ALPHA = 0.08;

// Path preview chevrons + destination ring
const PATH_COLOR   = 0xffffff;
const PATH_STROKE  = 0x000000;
const PATH_ALPHA   = 0.95;
const CHEVRON_R    = 7;                    // half-width of a chevron triangle
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
/** Area-footprint layer. Separate Graphics so the hover redraw doesn't wipe
 *  whatever _graphics is showing (usually nothing during area mode — the
 *  range-overlay effect deliberately leaves the base layer blank and lets the
 *  blast diamond BE the targeting feedback — but keeping layers independent
 *  means we never have to reason about coupling). */
let _areaGraphics: Graphics | null = null;
/** Separate Graphics for the path preview so showPathPreview() can redraw on
 *  every mouse-move without wiping the blue reachable-tile fills. Added to the
 *  layer last → draws on top (Pixi children render in insertion order when
 *  sortableChildren is off). Path and area never coexist (move mode vs spell
 *  mode) so the z-order between those two is academic. */
let _pathGraphics: Graphics | null = null;

export function initRangeOverlay(layer: Container): void {
  // Guard against re-initialisation (e.g. hot-reload): clean up old Graphics
  // objects before creating new ones.
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

/** Remove all highlights. */
export function clearRangeOverlay(): void {
  _graphics?.clear();
  _areaGraphics?.clear();
  _pathGraphics?.clear();
}

// ---------------------------------------------------------------------------
// Area footprint — shape preview for burst/cone/line spells.
//
// The tile set here MUST match what the reducer's area_save_damage handler
// actually hits. Each shape branch mirrors the corresponding reducer branch
// (reducer.ts ~1525-1560):
//   burst: radiusPoints(aim, sizeTiles), LoE from centre
//   cone:  conePoints(actor, aim, sizeTiles), LoE from actor
//   line:  lineAimPoints(actor, aim, sizeTiles), stop at blocked
//
// tilesFromFeet is duplicated from reducer.ts (its copy is module-private);
// if these drift the player sees a red tile the spell doesn't touch, or vice
// versa. Keep `Math.max(1, Math.floor((feet + 4) / 5))` in sync.
//
// Tiles the reducer would exclude (LoE fail / past a blocked wall) are drawn
// very faint instead of hidden. That way obstruction is legible: bright red
// stops at the wall, faint red continues past it.
// ---------------------------------------------------------------------------

/** PF2e 5ft grid. Duplicate of reducer.ts:tilesFromFeet — see block comment. */
function tilesFromFeet(feet: number): number {
  return Math.max(1, Math.floor((feet + 4) / 5));
}

export type AreaSpec = { shape: "burst" | "cone" | "line"; sizeFeet: number };

export function showAreaFootprint(
  aimX: number,
  aimY: number,
  area: AreaSpec,
  state: BattleState,
  actorX: number,
  actorY: number,
): void {
  if (!_areaGraphics) return;
  _areaGraphics.clear();

  const sizeTiles = tilesFromFeet(area.sizeFeet);

  if (area.shape === "burst") {
    // Burst: aim is the CENTRE. LoE measured from centre outward.
    for (const [tx, ty] of radiusPoints(aimX, aimY, sizeTiles)) {
      if (!inBounds(state, tx, ty)) continue;
      const hit = hasTileLineOfEffect(state, aimX, aimY, tx, ty);
      drawTile(_areaGraphics, tx, ty, AREA_FILL, hit ? AREA_ALPHA : AREA_SHADOW_ALPHA);
    }
    return;
  }

  if (area.shape === "cone") {
    // Cone: emanates from actor toward aim. LoE measured from actor.
    // conePoints includes the origin tile — skip it (the caster doesn't
    // hit themselves unless include_actor, which the reducer checks
    // separately).
    for (const [tx, ty] of conePoints(actorX, actorY, aimX, aimY, sizeTiles)) {
      if (tx === actorX && ty === actorY) continue;
      if (!inBounds(state, tx, ty)) continue;
      const hit = hasTileLineOfEffect(state, actorX, actorY, tx, ty);
      drawTile(_areaGraphics, tx, ty, AREA_FILL, hit ? AREA_ALPHA : AREA_SHADOW_ALPHA);
    }
    return;
  }

  // Line: fixed length in the aim direction. Stops at the first blocked tile;
  // tiles beyond are drawn faint so the player sees "wall ate my bolt".
  const blockedSet = new Set(state.battleMap.blocked.map(([x, y]) => `${x},${y}`));
  let stopped = false;
  for (const [tx, ty] of lineAimPoints(actorX, actorY, aimX, aimY, sizeTiles)) {
    if (!inBounds(state, tx, ty)) break;
    if (blockedSet.has(`${tx},${ty}`)) stopped = true;
    drawTile(_areaGraphics, tx, ty, AREA_FILL, stopped ? AREA_SHADOW_ALPHA : AREA_ALPHA);
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
// way", not "came from here"). The destination gets an open ring so it's
// unambiguous where the unit will land.
//
// Chevron geometry: solid triangle, tip along the travel direction, two barbs
// swept back along the perpendicular. Movement is 8-connected (see DIRS in
// movement.ts) so a step may be diagonal — (dx,dy) ∈ {-1,0,1}² and length is
// 1 or √2. We normalise to a unit vector so a diagonal chevron is the same
// pixel size as an orthogonal one; the rotation falls out of the math.
// ---------------------------------------------------------------------------

function drawChevron(g: Graphics, cx: number, cy: number, dx: number, dy: number): void {
  // Normalise — diagonals arrive with |v|=√2 and would otherwise render ~40%
  // larger than orthogonal chevrons.
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  // Perpendicular for barb spread.
  const px = -uy, py = ux;
  const r = CHEVRON_R;
  g.poly([
    cx + ux * r,          cy + uy * r,           // tip
    cx - ux * r + px * r, cy - uy * r + py * r,  // barb
    cx - ux * r - px * r, cy - uy * r - py * r,  // barb
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
