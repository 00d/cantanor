/**
 * Camera controller — pan, zoom, focus on units.
 * Uses smooth lerp interpolation rather than instant snap.
 * Writes directly to the world container transform (transient, no React re-renders).
 * The world container sits between app.stage (identity) and all layers, so
 * TilemapPipe's uWorldTransformMatrix stays = identity and the camera is
 * applied exactly once to both tiles and sprites.
 */

import { Container } from "pixi.js";
import { TILE_SIZE } from "./pixiApp";

interface CameraState {
  targetX: number;
  targetY: number;
  targetZoom: number;
  currentX: number;
  currentY: number;
  currentZoom: number;
}

const LERP_SPEED = 0.12;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;

const _cam: CameraState = {
  targetX: 0,
  targetY: 0,
  targetZoom: 1,
  currentX: 0,
  currentY: 0,
  currentZoom: 1,
};

let _stageRoot: Container | null = null;
let _viewWidth = 0;
let _viewHeight = 0;
// World extents in world-pixels (pre-zoom). 0 means "unbounded" — the clamp
// is a no-op until setCameraBounds() has been called. That's deliberate:
// the camera shouldn't have to know the map size at init time (it doesn't
// exist yet — battle loads later), and the unbounded default preserves
// pre-clamp behaviour on any load path that forgets to set bounds.
let _worldW = 0;
let _worldH = 0;

export function initCamera(stageRoot: Container, viewWidth: number, viewHeight: number): void {
  _stageRoot = stageRoot;
  _viewWidth = viewWidth;
  _viewHeight = viewHeight;
}

export function resizeCamera(viewWidth: number, viewHeight: number): void {
  _viewWidth = viewWidth;
  _viewHeight = viewHeight;
}

/** Set the pannable world extent, in TILES. tickCamera() clamps targetX/Y
 *  to keep this box filling the viewport — no panning into the void past
 *  the map edge. Call once per battle load. Pass 0 on either axis to
 *  disable the clamp on that axis. Takes tile counts (not pixels) for the
 *  same reason focusTile does: TILE_SIZE is a rendering constant, callers
 *  shouldn't need it. */
export function setCameraBounds(tilesW: number, tilesH: number): void {
  _worldW = tilesW * TILE_SIZE;
  _worldH = tilesH * TILE_SIZE;
}

/** Clamp one camera axis.
 *
 *  targetX is the screen-space position of world-origin (0,0): a world point
 *  `wx` appears at screen `targetX + wx*zoom`. We want the map to always fill
 *  the viewport:
 *    - left edge of map (wx=0) at screen `targetX` must not drift right of 0
 *      → targetX ≤ 0
 *    - right edge (wx=worldW) at `targetX + worldW*zoom` must not drift left
 *      of viewW → targetX ≥ viewW − worldW*zoom
 *    → targetX ∈ [viewW − worldW*zoom, 0]
 *
 *  If worldW*zoom < viewW the map is smaller than the viewport and that range
 *  inverts (lo > hi). Centre instead — pins a tiny test arena to the middle
 *  of the screen rather than letting it float around in the void or snap to a
 *  corner. This is also what happens if the player zooms out far enough on a
 *  normal-sized map; MIN_ZOOM=0.3 × a 20-tile map = 192px, smaller than most
 *  viewports, so this branch fires in practice. */
function clampAxis(target: number, viewLen: number, worldLen: number, zoom: number): number {
  if (worldLen === 0) return target;  // unbounded
  const worldScreenLen = worldLen * zoom;
  if (worldScreenLen < viewLen) {
    return (viewLen - worldScreenLen) / 2;
  }
  const lo = viewLen - worldScreenLen;
  return Math.max(lo, Math.min(0, target));
}

export function focusTile(tileX: number, tileY: number): void {
  _cam.targetX = _viewWidth / 2 - (tileX + 0.5) * TILE_SIZE * _cam.targetZoom;
  _cam.targetY = _viewHeight / 2 - (tileY + 0.5) * TILE_SIZE * _cam.targetZoom;
}

export function panBy(dx: number, dy: number): void {
  _cam.targetX += dx;
  _cam.targetY += dy;
}

export function zoom(factor: number, pivotX?: number, pivotY?: number): void {
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, _cam.targetZoom * factor));
  const px = pivotX ?? _viewWidth / 2;
  const py = pivotY ?? _viewHeight / 2;

  // Adjust target position to keep pivot point stable
  _cam.targetX = px - (px - _cam.targetX) * (newZoom / _cam.targetZoom);
  _cam.targetY = py - (py - _cam.targetY) * (newZoom / _cam.targetZoom);
  _cam.targetZoom = newZoom;
}

export function tickCamera(): void {
  if (!_stageRoot) return;

  // Clamp TARGETS, not currents, and do it HERE, not in panBy/focusTile/zoom.
  // One site catches all three inputs. Clamping the target (not the current)
  // means that dragging the pan way off-map pins targetX at the wall and the
  // lerp settles gently against it — clamping currentX instead would leave
  // targetX at -5000, and every frame the lerp would pull toward -5000 and
  // the clamp would yank it back. That reads as "sticky" (the edge has no
  // give; release is instant because there's no lerp distance to unwind).
  //
  // Re-runs every frame against targetZoom, so a zoom-out can't leave
  // targetX stuck at a now-invalid position. The valid range shrinks as zoom
  // shrinks (worldW*zoom gets smaller, lo rises toward 0) — the clamp will
  // pull targetX in to match, and the lerp will ease the camera inward.
  _cam.targetX = clampAxis(_cam.targetX, _viewWidth,  _worldW, _cam.targetZoom);
  _cam.targetY = clampAxis(_cam.targetY, _viewHeight, _worldH, _cam.targetZoom);

  // Lerp toward targets
  _cam.currentX += (_cam.targetX - _cam.currentX) * LERP_SPEED;
  _cam.currentY += (_cam.targetY - _cam.currentY) * LERP_SPEED;
  _cam.currentZoom += (_cam.targetZoom - _cam.currentZoom) * LERP_SPEED;

  _stageRoot.position.set(_cam.currentX, _cam.currentY);
  _stageRoot.scale.set(_cam.currentZoom, _cam.currentZoom);
}

export function getCameraState() {
  return {
    x: _cam.currentX,
    y: _cam.currentY,
    zoom: _cam.currentZoom,
  };
}

export function screenToTile(screenX: number, screenY: number): [number, number] {
  const worldX = (screenX - _cam.currentX) / _cam.currentZoom;
  const worldY = (screenY - _cam.currentY) / _cam.currentZoom;
  return [Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE)];
}
