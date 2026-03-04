/**
 * Async sprite sheet loader with frame slicing and caching.
 *
 * Loads sprite sheet descriptors (JSON) and their texture images,
 * slices frames from the sheet, and caches results by descriptor path.
 *
 * Architecture mirrors tilesetLoader.ts patterns:
 *   - Async loading via Assets.load
 *   - Map-based cache keyed by descriptor URL
 *   - Graceful fallback when assets are unavailable
 */

import { Assets, Texture, Rectangle } from "pixi.js";
import type { SpriteSheetDescriptor, LoadedSpriteSheet } from "./spriteSheetTypes";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const _cache = new Map<string, LoadedSpriteSheet>();

/**
 * Load and cache a sprite sheet from its descriptor URL.
 * Returns null if loading fails (missing asset, invalid JSON, etc.).
 *
 * The descriptor JSON is fetched first, then the texture image is loaded
 * via PixiJS Assets. Frames are sliced from the texture using Rectangle
 * regions based on frameWidth/frameHeight.
 */
export async function loadSpriteSheet(
  descriptorUrl: string,
): Promise<LoadedSpriteSheet | null> {
  // Check cache
  const cached = _cache.get(descriptorUrl);
  if (cached) return cached;

  try {
    // Fetch descriptor JSON
    const response = await fetch(descriptorUrl);
    if (!response.ok) return null;
    const descriptor = (await response.json()) as SpriteSheetDescriptor;

    // Validate required fields
    if (!descriptor.texture || !descriptor.frameWidth || !descriptor.frameHeight) {
      console.warn(`Invalid sprite sheet descriptor: ${descriptorUrl}`);
      return null;
    }

    // Load the texture image
    const baseTexture = await Assets.load<Texture>(descriptor.texture);
    if (!baseTexture) return null;

    // Slice frames from the texture
    const cols = Math.floor(baseTexture.width / descriptor.frameWidth);
    const rows = Math.floor(baseTexture.height / descriptor.frameHeight);
    const totalFrames = cols * rows;

    const frames: Texture[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const frame = new Texture({
        source: baseTexture.source,
        frame: new Rectangle(
          col * descriptor.frameWidth,
          row * descriptor.frameHeight,
          descriptor.frameWidth,
          descriptor.frameHeight,
        ),
      });
      frames.push(frame);
    }

    const loaded: LoadedSpriteSheet = { descriptor, frames };
    _cache.set(descriptorUrl, loaded);
    return loaded;
  } catch (err) {
    console.warn(`Failed to load sprite sheet ${descriptorUrl}:`, err);
    return null;
  }
}

/** Clear the sprite sheet cache (used for hot-reload/testing). */
export function clearSpriteSheetCache(): void {
  _cache.clear();
}

/** Check if a sprite sheet is already cached. */
export function isSpriteSheetCached(descriptorUrl: string): boolean {
  return _cache.has(descriptorUrl);
}
