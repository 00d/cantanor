/**
 * Camera controller — pan, zoom, focus on units.
 * Uses smooth lerp interpolation rather than instant snap.
 * Writes directly to the stage container transform (transient, no React re-renders).
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

export function initCamera(stageRoot: Container, viewWidth: number, viewHeight: number): void {
  _stageRoot = stageRoot;
  _viewWidth = viewWidth;
  _viewHeight = viewHeight;
}

export function resizeCamera(viewWidth: number, viewHeight: number): void {
  _viewWidth = viewWidth;
  _viewHeight = viewHeight;
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
