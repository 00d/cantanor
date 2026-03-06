/**
 * Persistent terrain property overlay for the PixiJS canvas.
 *
 * Renders subtle indicators for moveCost (difficult terrain) and coverGrade
 * tiles that remain visible at all times — unlike the range overlay which is
 * cleared/redrawn on target mode changes.
 */

import { Container, Graphics } from "pixi.js";
import { MapState } from "../engine/state";
import { TILE_SIZE } from "./pixiApp";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const DIFFICULT_FILL = 0xffaa22;
const DIFFICULT_FILL_ALPHA = 0.12;
const DIFFICULT_HATCH_ALPHA = 0.35;

const COVER_STANDARD_COLOR = 0x4488ff;
const COVER_GREATER_COLOR = 0x2244cc;

const HAZARD_FILL_ALPHA = 0.18;
const HAZARD_BORDER_ALPHA = 0.5;
/** Element → tint. Falls back to the "fire" red for unknown types. */
const HAZARD_COLORS: Record<string, number> = {
  fire: 0xff4422,
  cold: 0x44aaff,
  acid: 0x66cc44,
  poison: 0x44aa44,
  electricity: 0xffdd22,
  electric: 0xffdd22,
  negative: 0x9944cc,
  force: 0xcc66ff,
};

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

/** Amber tint + diagonal cross-hatch for difficult terrain tiles. */
function drawDifficultTerrain(g: Graphics, tx: number, ty: number): void {
  const px = tx * TILE_SIZE;
  const py = ty * TILE_SIZE;

  // Subtle amber background tint
  g.rect(px, py, TILE_SIZE, TILE_SIZE);
  g.fill({ color: DIFFICULT_FILL, alpha: DIFFICULT_FILL_ALPHA });

  // Diagonal cross-hatch lines
  g.moveTo(px, py);
  g.lineTo(px + TILE_SIZE, py + TILE_SIZE);
  g.moveTo(px + TILE_SIZE, py);
  g.lineTo(px, py + TILE_SIZE);
  g.stroke({ color: DIFFICULT_FILL, alpha: DIFFICULT_HATCH_ALPHA, width: 1 });
}

/**
 * Element-tinted fill + inset border for hazard tiles. Danger marker in
 * the top-left corner (small triangle) distinguishes from difficult terrain.
 */
function drawHazardTile(g: Graphics, tx: number, ty: number, color: number): void {
  const px = tx * TILE_SIZE;
  const py = ty * TILE_SIZE;

  // Background tint
  g.rect(px, py, TILE_SIZE, TILE_SIZE);
  g.fill({ color, alpha: HAZARD_FILL_ALPHA });

  // Inset border (3px margin so it reads inside tile grid lines)
  g.rect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  g.stroke({ color, alpha: HAZARD_BORDER_ALPHA, width: 1.5 });

  // Top-left danger triangle
  const s = 9;
  g.moveTo(px + 4, py + 4);
  g.lineTo(px + 4 + s, py + 4);
  g.lineTo(px + 4, py + 4 + s);
  g.closePath();
  g.fill({ color, alpha: 0.7 });
}

/** Small upward chevron in bottom-right corner for cover tiles. */
function drawCoverChevron(g: Graphics, tx: number, ty: number, grade: number): void {
  const px = tx * TILE_SIZE;
  const py = ty * TILE_SIZE;

  const color = grade >= 2 ? COVER_GREATER_COLOR : COVER_STANDARD_COLOR;
  const alpha = grade >= 2 ? 0.55 : 0.45;
  const width = grade >= 2 ? 2.5 : 1.5;
  const size = grade >= 2 ? 10 : 8;

  // Chevron centre in bottom-right quadrant
  const cx = px + TILE_SIZE - 12;
  const cy = py + TILE_SIZE - 10;

  g.moveTo(cx - size / 2, cy + size / 3);
  g.lineTo(cx, cy - size / 3);
  g.lineTo(cx + size / 2, cy + size / 3);
  g.stroke({ color, alpha, width });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _overlay: Container | null = null;
let _graphics: Graphics | null = null;

export function initTerrainOverlay(layer: Container): void {
  if (_graphics && _overlay) {
    _overlay.removeChild(_graphics);
    _graphics.destroy();
    _graphics = null;
  }
  _overlay = layer;
  _graphics = new Graphics();
  _graphics.label = "terrain_overlay";
  _overlay.addChild(_graphics);
}

/**
 * Render persistent terrain indicators for moveCost and coverGrade tiles.
 * Called once when a battle loads; the graphics persist until cleared.
 */
export function renderTerrainOverlay(mapState: MapState): void {
  if (!_graphics) return;
  _graphics.clear();

  // Difficult terrain tiles (moveCost > 1)
  if (mapState.moveCost) {
    for (const [key, cost] of Object.entries(mapState.moveCost)) {
      if (cost > 1) {
        const [tx, ty] = parseTileKey(key);
        drawDifficultTerrain(_graphics, tx, ty);
      }
    }
  }

  // Cover tiles (coverGrade > 0)
  if (mapState.coverGrade) {
    for (const [key, grade] of Object.entries(mapState.coverGrade)) {
      if (grade > 0) {
        const [tx, ty] = parseTileKey(key);
        drawCoverChevron(_graphics, tx, ty, grade);
      }
    }
  }

  // Hazard zones — draw after difficult terrain so the element tint reads
  // on top of the amber hatch if they coincide.
  if (mapState.hazards) {
    for (const zone of mapState.hazards) {
      const color = HAZARD_COLORS[zone.damageType.toLowerCase()] ?? HAZARD_COLORS.fire;
      for (const [tx, ty] of zone.tiles) {
        drawHazardTile(_graphics, tx, ty, color);
      }
    }
  }
}

/** Remove all terrain indicators. */
export function clearTerrainOverlay(): void {
  _graphics?.clear();
}
