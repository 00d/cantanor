/**
 * Tiled tilemap renderer — replaces renderTileMap() when a Tiled map is loaded.
 *
 * Uses @pixi/tilemap's CompositeTilemap for GPU-batched tile rendering
 * (one draw call per tileset texture).  The legacy tileRenderer.ts is kept
 * unchanged for hand-written JSON scenarios.
 *
 * Coordinate space
 * ─────────────────
 * Tiles are placed at (col * tilewidth, row * tileheight) in the source
 * tileset's pixel space (e.g. 32 px for the dungeon_basic tileset).
 * The CompositeTilemap container is scaled by (TILE_SIZE / tilewidth) so
 * that its world-space positions match the 64-pixel grid used by unit
 * sprites, the camera, and the grid overlay.
 *
 * Why tileWidth/tileHeight options are omitted from tile() calls
 * ──────────────────────────────────────────────────────────────
 * In @pixi/tilemap v5, the tileWidth/tileHeight option controls BOTH the
 * quad vertex extent (x+w, y+h) AND the UV pixel range in the atlas
 * (u+w, v+h).  Passing TILE_SIZE (64) for a 32-px source frame would make
 * the UV read 64 px from the atlas starting at frame.x, overrunning into
 * the neighbouring tile and producing a corrupted "checkered weave" pattern.
 * Omitting the option lets it default to texture.orig.width/height (= the
 * source frame size), which is always correct.
 *
 * Why the camera is applied to worldContainer, not app.stage
 * ──────────────────────────────────────────────────────────
 * TilemapPipe computes:
 *   u_proj_trans = proj * uWorldTransformMatrix * tilemap.worldTransform
 * where uWorldTransformMatrix = stage.renderGroup.worldTransform.
 * If the camera were on app.stage, the camera translation would appear in
 * BOTH uWorldTransformMatrix and tilemap.worldTransform (worldTransform
 * accumulates all ancestor transforms), causing the camera offset to be
 * applied twice.  Keeping app.stage as identity ensures
 * uWorldTransformMatrix = identity so the camera acts exactly once.
 */

import { Container, Graphics, Texture } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import type { ResolvedTiledMap } from "../io/tiledTypes";
import { TILE_SIZE } from "./pixiApp";

// ---------------------------------------------------------------------------
// Module-level state (matches the pattern used in tileRenderer.ts)
// ---------------------------------------------------------------------------

let _tilemap: CompositeTilemap | null = null;
let _gridGraphic: Graphics | null = null;
let _hoverGraphic: Graphics | null = null;
/** Cached reference so updateGridOverlay / setHoverTile can use tilewidth. */
let _currentMap: ResolvedTiledMap | null = null;

// ---------------------------------------------------------------------------
// Flip-flag strip (same constant as tiledLoader.ts, duplicated to avoid import)
// ---------------------------------------------------------------------------

const FLIP_MASK = 0x1fffffff;

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Renders a Tiled map onto `parent` (the "map" layer from pixiApp.ts).
 * Tears down any previously rendered tilemap first.
 *
 * @param parent       The PixiJS Container that owns the map layer.
 * @param tiledMap     The fully-resolved map (tilesets embedded).
 * @param tileTextures A GID → Texture lookup produced by tilesetLoader.ts.
 * @param showGrid     Whether to draw grid-line overlay on top of tile art.
 */
export function renderTiledMap(
  parent: Container,
  tiledMap: ResolvedTiledMap,
  tileTextures: Map<number, Texture>,
  showGrid: boolean,
): void {
  // Tear down previous render
  _teardown(parent);

  _currentMap = tiledMap;

  // --- CompositeTilemap ---
  // Scale the container so that source-space tile positions (col * tilewidth, e.g. col*32)
  // map to the 64-pixel world grid (col * TILE_SIZE = col*64) used by unit sprites and the
  // camera.  tileWidth/tileHeight are intentionally omitted so they default to
  // texture.orig.width/height (source frame size, e.g. 32 px), keeping UV coordinates
  // within the atlas frame.  See module comment for the full reasoning.
  _tilemap = new CompositeTilemap();
  _tilemap.label = "tiled_map";
  _tilemap.scale.set(TILE_SIZE / tiledMap.tilewidth);

  for (const layer of tiledMap.layers) {
    if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;

    for (let i = 0; i < layer.data.length; i++) {
      const rawGid = layer.data[i];
      const gid = rawGid & FLIP_MASK;
      if (gid === 0) continue; // empty cell

      const texture = tileTextures.get(gid);
      if (!texture) continue;

      const x = (i % tiledMap.width) * tiledMap.tilewidth;
      const y = Math.floor(i / tiledMap.width) * tiledMap.tileheight;
      _tilemap.tile(texture, x, y);
    }
  }

  parent.addChild(_tilemap);

  // --- Grid overlay ---
  _gridGraphic = new Graphics();
  _gridGraphic.label = "tiled_grid";
  parent.addChild(_gridGraphic);
  _drawGrid(showGrid);

  // --- Hover highlight ---
  _hoverGraphic = new Graphics();
  _hoverGraphic.label = "tiled_hover";
  _hoverGraphic.visible = false;
  parent.addChild(_hoverGraphic);
}

// ---------------------------------------------------------------------------
// Grid overlay
// ---------------------------------------------------------------------------

/**
 * Draws (or hides) the grid overlay.
 * Call this whenever `showGrid` changes in the store.
 */
export function updateGridOverlay(showGrid: boolean): void {
  if (!_gridGraphic || !_currentMap) return;
  _drawGrid(showGrid);
}

function _drawGrid(showGrid: boolean): void {
  if (!_gridGraphic || !_currentMap) return;

  _gridGraphic.clear();

  if (!showGrid) {
    _gridGraphic.visible = false;
    return;
  }

  const { width, height } = _currentMap;
  // Grid is drawn in TILE_SIZE space (same as the camera) because it is a
  // sibling of the CompositeTilemap container, not a child.
  const gw = TILE_SIZE;
  const gh = TILE_SIZE;

  _gridGraphic.setStrokeStyle({ width: 1, color: 0x3a3a5c, alpha: 0.35 });

  for (let tx = 0; tx <= width; tx++) {
    _gridGraphic.moveTo(tx * gw, 0).lineTo(tx * gw, height * gh);
  }
  for (let ty = 0; ty <= height; ty++) {
    _gridGraphic.moveTo(0, ty * gh).lineTo(width * gw, ty * gh);
  }
  _gridGraphic.stroke();
  _gridGraphic.visible = true;
}

// ---------------------------------------------------------------------------
// Hover tile highlight
// ---------------------------------------------------------------------------

const HOVER_COLOR = 0x4a4a6a;

/**
 * Highlights a tile at grid position `pos`, or clears the highlight if null.
 * Drop-in replacement for setHoverTile() in tileRenderer.ts.
 */
export function setHoverTileTiled(pos: [number, number] | null): void {
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

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

function _teardown(parent: Container): void {
  if (_tilemap) {
    parent.removeChild(_tilemap);
    _tilemap.destroy();
    _tilemap = null;
  }
  if (_gridGraphic) {
    parent.removeChild(_gridGraphic);
    _gridGraphic.destroy();
    _gridGraphic = null;
  }
  if (_hoverGraphic) {
    parent.removeChild(_hoverGraphic);
    _hoverGraphic.destroy();
    _hoverGraphic = null;
  }
  _currentMap = null;
}

/**
 * Clears the Tiled renderer state.  Call when switching to a legacy scenario.
 */
export function clearTiledRenderer(parent: Container): void {
  _teardown(parent);
}
