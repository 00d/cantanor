/**
 * Tiled map loader — fetches a .tmj file, resolves external .tsj tileset
 * references, and returns a fully-resolved ResolvedTiledMap.
 *
 * Only the IO layer calls this module. The engine, grid, and rules layers
 * remain completely unaware of Tiled.
 */

import type {
  TiledMap,
  TiledTileset,
  TiledTilesetRef,
  TiledTileDefinition,
  TiledProperty,
  ResolvedTiledMap,
} from "./tiledTypes";

// ---------------------------------------------------------------------------
// Flip-flag constants (upper 3 bits of a GID encode H/V/D flips)
// ---------------------------------------------------------------------------

const FLIP_MASK = 0x1fffffff;

// ---------------------------------------------------------------------------
// URL resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolves a path that is relative to a base URL.
 * Works for both full URLs ("https://...") and root-relative paths ("/maps/foo.tmj").
 *
 * Examples:
 *   resolveUrl("/maps/dungeon.tmj", "../tilesets/floor.tsj") → "/tilesets/floor.tsj"
 *   resolveUrl("/maps/dungeon.tmj", "floor.tsj")             → "/maps/floor.tsj"
 */
function resolveUrl(base: string, relative: string): string {
  // Use the URL constructor with a dummy origin so relative paths work correctly
  // even when base is a root-relative path like "/maps/dungeon.tmj".
  const origin = "http://localhost";
  const abs = new URL(relative, new URL(base, origin));
  // Return just the pathname (drops the dummy origin)
  return abs.pathname;
}

// ---------------------------------------------------------------------------
// External tileset resolution
// ---------------------------------------------------------------------------

/**
 * Checks whether a tileset ref is external (has a "source" field but no "image").
 */
function isExternalRef(ref: TiledTilesetRef): ref is { firstgid: number; source: string } {
  return "source" in ref && !("image" in ref);
}

/**
 * Fetches an external .tsj file and returns a fully-resolved TiledTileset,
 * with the firstgid from the map's tileset reference merged back in.
 */
async function fetchExternalTileset(
  ref: { firstgid: number; source: string },
  mapUrl: string,
): Promise<TiledTileset> {
  const tsjUrl = resolveUrl(mapUrl, ref.source);
  const response = await fetch(tsjUrl);
  if (!response.ok) {
    throw new Error(`tiledLoader: failed to fetch external tileset "${tsjUrl}" (${response.status})`);
  }
  const tsj = (await response.json()) as Omit<TiledTileset, "firstgid">;
  return { ...tsj, firstgid: ref.firstgid };
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Fetches a Tiled map from `url` and returns a fully-resolved map where all
 * external .tsj tileset references have been fetched and merged inline.
 *
 * Throws if the fetch fails, if JSON is invalid, or if an external tileset
 * cannot be loaded.
 */
export async function loadTiledMap(url: string): Promise<ResolvedTiledMap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`tiledLoader: failed to fetch map "${url}" (${response.status})`);
  }
  const raw = (await response.json()) as TiledMap;

  // Resolve all tileset references concurrently
  const tilesets: TiledTileset[] = await Promise.all(
    raw.tilesets.map((ref) =>
      isExternalRef(ref) ? fetchExternalTileset(ref, url) : Promise.resolve(ref as TiledTileset),
    ),
  );

  // Sort tilesets by firstgid ascending (important for GID resolution)
  tilesets.sort((a, b) => a.firstgid - b.firstgid);

  return { ...raw, tilesets };
}

// ---------------------------------------------------------------------------
// GID resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a raw GID (which may have flip flags in the upper 3 bits) to its
 * source tileset and local tile ID within that tileset.
 *
 * Returns null if gid is 0 (empty cell) or no tileset contains it.
 */
export function resolveTileGid(
  gid: number,
  tilesets: TiledTileset[],
): { tileset: TiledTileset; localId: number } | null {
  const cleanGid = gid & FLIP_MASK;
  if (cleanGid === 0) return null;

  // Walk tilesets in reverse firstgid order to find the correct one.
  // Tilesets are sorted ascending, so iterate reversed.
  for (let i = tilesets.length - 1; i >= 0; i--) {
    const ts = tilesets[i];
    if (cleanGid >= ts.firstgid) {
      const localId = cleanGid - ts.firstgid;
      if (localId < ts.tilecount) {
        return { tileset: ts, localId };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

/**
 * Converts a TiledProperty array into a plain key→value record.
 * Returns an empty object if `props` is undefined or empty.
 */
export function getProperties(props?: TiledProperty[]): Record<string, unknown> {
  if (!props || props.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const p of props) {
    result[p.name] = p.value;
  }
  return result;
}

/**
 * Returns the custom properties for a specific local tile ID within a tileset.
 * Returns an empty object if the tile has no properties.
 */
export function getTileProperties(
  tileset: TiledTileset,
  localId: number,
): Record<string, unknown> {
  if (!tileset.tiles) return {};
  const def: TiledTileDefinition | undefined = tileset.tiles.find((t) => t.id === localId);
  return def ? getProperties(def.properties) : {};
}
