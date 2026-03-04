/**
 * PixiJS application setup and lifecycle management.
 * Initializes the renderer and manages the main stage hierarchy.
 *
 * Layer hierarchy:
 *   stage (identity — never transformed)
 *     └─ worldContainer  ← camera pan/zoom applied here
 *          ├─ mapLayer
 *          ├─ unitsLayer
 *          └─ effectsLayer
 *
 * Keeping the stage as identity is essential for @pixi/tilemap's TilemapPipe:
 * TilemapPipe computes u_proj_trans = proj * uWorldTransformMatrix * tilemap.worldTransform.
 * uWorldTransformMatrix = stage.renderGroup.worldTransform.  If the camera were applied to
 * the stage, it would appear in BOTH uWorldTransformMatrix and tilemap.worldTransform
 * (since worldTransform includes all ancestors), causing the camera translation to be
 * applied twice and tiles to be offset relative to sprites.  Applying the camera to
 * worldContainer instead keeps stage = identity so that uWorldTransformMatrix = identity
 * and the camera is applied exactly once via tilemap.worldTransform.
 */

import { Application, Container } from "pixi.js";

export const TILE_SIZE = 64;

export interface PixiLayers {
  map: Container;
  /** Tile-range and target highlights, rendered between the map and unit sprites. */
  overlay: Container;
  units: Container;
  effects: Container;
  ui: Container;
}

let _app: Application | null = null;
let _layers: PixiLayers | null = null;
let _world: Container | null = null;

export async function initPixiApp(canvas: HTMLCanvasElement): Promise<Application> {
  if (_app) return _app;

  const app = new Application();
  await app.init({
    canvas,
    resizeTo: canvas.parentElement ?? canvas,
    antialias: false,
    backgroundColor: 0x1a1a2e,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // worldContainer receives camera transforms.  Stage is left as identity so that
  // TilemapPipe's uWorldTransformMatrix stays = identity (see module comment above).
  const worldContainer = new Container();
  worldContainer.label = "world";
  app.stage.addChild(worldContainer);

  // Layer hierarchy inside world space: map → overlay → units → effects → ui
  const mapLayer = new Container();
  const overlayLayer = new Container();
  const unitsLayer = new Container();
  const effectsLayer = new Container();
  const uiLayer = new Container();

  mapLayer.label = "map";
  overlayLayer.label = "overlay";
  unitsLayer.label = "units";
  effectsLayer.label = "effects";
  uiLayer.label = "ui";

  worldContainer.addChild(mapLayer);
  worldContainer.addChild(overlayLayer);
  worldContainer.addChild(unitsLayer);
  worldContainer.addChild(effectsLayer);
  worldContainer.addChild(uiLayer);

  _app = app;
  _world = worldContainer;
  _layers = { map: mapLayer, overlay: overlayLayer, units: unitsLayer, effects: effectsLayer, ui: uiLayer };

  return app;
}

export function getPixiApp(): Application {
  if (!_app) throw new Error("PixiJS app not initialized");
  return _app;
}

export function getPixiLayers(): PixiLayers {
  if (!_layers) throw new Error("PixiJS layers not initialized");
  return _layers;
}

/** Returns the world container that receives camera pan/zoom transforms. */
export function getPixiWorld(): Container {
  if (!_world) throw new Error("PixiJS app not initialized");
  return _world;
}

export function destroyPixiApp(): void {
  if (_app) {
    _app.destroy(true, { children: true });
    _app = null;
    _layers = null;
    _world = null;
  }
}
