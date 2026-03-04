/**
 * Tile grid renderer — draws the battle map as a tiled orthogonal grid.
 * Each tile is TILE_SIZE px. Blocked tiles render with a darker color.
 */

import { Container, Graphics } from "pixi.js";
import { MapState } from "../engine/state";
import { TILE_SIZE } from "./pixiApp";

const FLOOR_COLOR = 0x2d2d44;
const BLOCKED_COLOR = 0x111120;
const GRID_LINE_COLOR = 0x3a3a5c;
const HOVER_COLOR = 0x4a4a6a;

// Terrain indicator palette (matches terrainOverlay.ts)
const DIFFICULT_FILL = 0xffaa22;
const DIFFICULT_FILL_ALPHA = 0.12;
const DIFFICULT_HATCH_ALPHA = 0.35;
const COVER_STANDARD_COLOR = 0x4488ff;
const COVER_GREATER_COLOR = 0x2244cc;

let _tileContainer: Container | null = null;
let _hoverGraphic: Graphics | null = null;

export function renderTileMap(parent: Container, mapState: MapState): void {
  // Clear previous
  if (_tileContainer) {
    parent.removeChild(_tileContainer);
    _tileContainer.destroy({ children: true });
  }

  _tileContainer = new Container();
  _tileContainer.label = "tile_map";

  const blockedSet = new Set(mapState.blocked.map(([x, y]) => `${x},${y}`));
  const g = new Graphics();

  // Draw floor tiles
  for (let ty = 0; ty < mapState.height; ty++) {
    for (let tx = 0; tx < mapState.width; tx++) {
      const isBlocked = blockedSet.has(`${tx},${ty}`);
      const color = isBlocked ? BLOCKED_COLOR : FLOOR_COLOR;
      g.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1).fill(color);
    }
  }

  // Draw grid lines
  g.setStrokeStyle({ width: 1, color: GRID_LINE_COLOR, alpha: 0.4 });
  for (let tx = 0; tx <= mapState.width; tx++) {
    g.moveTo(tx * TILE_SIZE, 0).lineTo(tx * TILE_SIZE, mapState.height * TILE_SIZE);
  }
  for (let ty = 0; ty <= mapState.height; ty++) {
    g.moveTo(0, ty * TILE_SIZE).lineTo(mapState.width * TILE_SIZE, ty * TILE_SIZE);
  }
  g.stroke();

  // Difficult terrain indicators (moveCost > 1)
  if (mapState.moveCost) {
    for (const [key, cost] of Object.entries(mapState.moveCost)) {
      if (cost <= 1) continue;
      const [xs, ys] = key.split(",");
      const tx = Number(xs);
      const ty = Number(ys);
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;
      g.rect(px, py, TILE_SIZE, TILE_SIZE).fill({ color: DIFFICULT_FILL, alpha: DIFFICULT_FILL_ALPHA });
      g.moveTo(px, py).lineTo(px + TILE_SIZE, py + TILE_SIZE);
      g.moveTo(px + TILE_SIZE, py).lineTo(px, py + TILE_SIZE);
      g.stroke({ color: DIFFICULT_FILL, alpha: DIFFICULT_HATCH_ALPHA, width: 1 });
    }
  }

  // Cover tile chevrons (coverGrade > 0)
  if (mapState.coverGrade) {
    for (const [key, grade] of Object.entries(mapState.coverGrade)) {
      if (grade <= 0) continue;
      const [xs, ys] = key.split(",");
      const tx = Number(xs);
      const ty = Number(ys);
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;
      const color = grade >= 2 ? COVER_GREATER_COLOR : COVER_STANDARD_COLOR;
      const alpha = grade >= 2 ? 0.55 : 0.45;
      const width = grade >= 2 ? 2.5 : 1.5;
      const size = grade >= 2 ? 10 : 8;
      const cx = px + TILE_SIZE - 12;
      const cy = py + TILE_SIZE - 10;
      g.moveTo(cx - size / 2, cy + size / 3).lineTo(cx, cy - size / 3).lineTo(cx + size / 2, cy + size / 3);
      g.stroke({ color, alpha, width });
    }
  }

  _tileContainer.addChild(g);

  // Hover highlight graphic (reused)
  _hoverGraphic = new Graphics();
  _hoverGraphic.label = "hover";
  _hoverGraphic.visible = false;
  _tileContainer.addChild(_hoverGraphic);

  parent.addChild(_tileContainer);
}

export function clearTileMap(parent: Container): void {
  if (_tileContainer) {
    parent.removeChild(_tileContainer);
    _tileContainer.destroy({ children: true });
    _tileContainer = null;
  }
  _hoverGraphic = null;
}

export function setHoverTile(pos: [number, number] | null): void {
  if (!_hoverGraphic) return;
  if (!pos) {
    _hoverGraphic.visible = false;
    return;
  }
  const [tx, ty] = pos;
  _hoverGraphic.clear();
  _hoverGraphic
    .rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1)
    .fill({ color: HOVER_COLOR, alpha: 0.35 });
  _hoverGraphic.visible = true;
}
