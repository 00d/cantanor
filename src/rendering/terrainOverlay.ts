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
}

/** Remove all terrain indicators. */
export function clearTerrainOverlay(): void {
  _graphics?.clear();
}
