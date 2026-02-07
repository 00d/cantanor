/**
 * PixiJS application setup and lifecycle management.
 * Initializes the renderer and manages the main stage hierarchy.
 */

import { Application, Container } from "pixi.js";

export const TILE_SIZE = 64;

export interface PixiLayers {
  map: Container;
  units: Container;
  effects: Container;
  ui: Container;
}

let _app: Application | null = null;
let _layers: PixiLayers | null = null;

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

  // Layer hierarchy: map → units → effects → ui
  const mapLayer = new Container();
  const unitsLayer = new Container();
  const effectsLayer = new Container();
  const uiLayer = new Container();

  mapLayer.label = "map";
  unitsLayer.label = "units";
  effectsLayer.label = "effects";
  uiLayer.label = "ui";

  app.stage.addChild(mapLayer);
  app.stage.addChild(unitsLayer);
  app.stage.addChild(effectsLayer);
  app.stage.addChild(uiLayer);

  _app = app;
  _layers = { map: mapLayer, units: unitsLayer, effects: effectsLayer, ui: uiLayer };

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

export function destroyPixiApp(): void {
  if (_app) {
    _app.destroy(true, { children: true });
    _app = null;
    _layers = null;
  }
}
