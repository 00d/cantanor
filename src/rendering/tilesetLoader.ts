/**
 * Tileset texture loader — fetches tileset PNG images and slices them into
 * a GID → Texture lookup map for use by tiledTilemapRenderer.
 *
 * Uses the PixiJS Assets cache, so loading the same image URL twice is free.
 */

import { Assets, Texture, Rectangle } from "pixi.js";
import type { SCALE_MODE } from "pixi.js";
import type { ResolvedTiledMap, TiledTileset } from "../io/tiledTypes";
import { getProperties } from "../io/tiledLoader";

/**
 * Reads the tileset-level `filter` custom property and maps it to a PixiJS
 * scale mode. Defaults to `"nearest"` — all current tilesets (dungeon_basic,
 * temple_ruins) are 32px pixel art, and the CompositeTilemap container scales
 * them by TILE_SIZE/tilewidth (2× for 32px source). Linear filtering on a 2×
 * upscale softens pixel edges; nearest keeps them crisp.
 *
 * Set `filter: "smooth"` on a tileset's custom properties (Tileset → Tileset
 * Properties in the Tiled editor) for painted/anti-aliased art where linear
 * filtering is desired — typically 64px+ source tiles that render at 1× scale
 * or below.
 */
function tilesetScaleMode(tileset: TiledTileset): SCALE_MODE {
  const props = getProperties(tileset.properties);
  return props["filter"] === "smooth" ? "linear" : "nearest";
}

/**
 * Resolves a tileset image path (relative to the .tmj file's location) into
 * a root-relative URL that Vite serves from public/.
 *
 * Examples:
 *   mapUrl="/maps/dungeon_arena_01.tmj", image="../tilesets/dungeon_basic.png"
 *   → "/tilesets/dungeon_basic.png"
 *
 *   mapUrl="/maps/dungeon_arena_01.tmj", image="tilesets/dungeon_basic.png"
 *   → "/maps/tilesets/dungeon_basic.png"
 */
function resolveTilesetImageUrl(mapUrl: string, imagePath: string): string {
  const base = new URL(mapUrl, "http://localhost");
  const resolved = new URL(imagePath, base);
  return resolved.pathname;
}

/**
 * Slices a loaded tileset source texture into individual per-GID textures.
 * Returns a map from global tile ID → Texture.
 */
function sliceTileTextures(
  sourceTexture: Texture,
  tileset: TiledTileset,
): Map<number, Texture> {
  const textures = new Map<number, Texture>();

  for (let localId = 0; localId < tileset.tilecount; localId++) {
    const col = localId % tileset.columns;
    const row = Math.floor(localId / tileset.columns);
    const frameX = tileset.margin + col * (tileset.tilewidth + tileset.spacing);
    const frameY = tileset.margin + row * (tileset.tileheight + tileset.spacing);

    const texture = new Texture({
      source: sourceTexture.source,
      frame: new Rectangle(frameX, frameY, tileset.tilewidth, tileset.tileheight),
    });

    textures.set(tileset.firstgid + localId, texture);
  }

  return textures;
}

/**
 * Loads all tilesets referenced by a ResolvedTiledMap and returns a merged
 * GID → Texture lookup covering all tilesets.
 *
 * @param tiledMap   The fully-resolved map (all tilesets embedded).
 * @param mapUrl     The URL of the .tmj file; used to resolve relative image paths.
 */
export async function loadTilesetTextures(
  tiledMap: ResolvedTiledMap,
  mapUrl: string,
): Promise<Map<number, Texture>> {
  const allTextures = new Map<number, Texture>();

  for (const tileset of tiledMap.tilesets) {
    const imageUrl = resolveTilesetImageUrl(mapUrl, tileset.image);

    // Assets.load is cached — duplicate calls return the same texture
    const sourceTexture = await Assets.load<Texture>(imageUrl);

    // scaleMode lives on the TextureSource (the atlas image), not on the
    // per-tile Texture frames that share it. Setting it once here covers every
    // frame sliceTileTextures is about to produce. Because Assets.load caches
    // by URL, two tilesets pointing at the same PNG share one TextureSource —
    // the last tileset's `filter` wins. In practice every tileset in a map is
    // either all pixel art or all painted, so this doesn't bite.
    sourceTexture.source.scaleMode = tilesetScaleMode(tileset);

    const sliced = sliceTileTextures(sourceTexture, tileset);
    for (const [gid, tex] of sliced) {
      allTextures.set(gid, tex);
    }
  }

  return allTextures;
}
