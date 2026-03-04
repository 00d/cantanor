/**
 * TypeScript interfaces for the Tiled Map Editor JSON format (.tmj / .tsj).
 * Mirrors the official Tiled JSON spec:
 * https://doc.mapeditor.org/en/stable/reference/json-map-format/
 *
 * These types are used exclusively by the IO layer (tiledLoader, mapDataBridge).
 * The engine, grid, and rules layers never see these types.
 */

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/** A custom property on any Tiled element (map, layer, tile, object). */
export interface TiledProperty {
  name: string;
  type: "string" | "int" | "float" | "bool" | "color" | "file" | "object" | "class";
  value: unknown;
  /** Set when type === "class", names the custom property type. */
  propertytype?: string;
}

// ---------------------------------------------------------------------------
// Objects (used in object layers)
// ---------------------------------------------------------------------------

/** A free-form object placed in an object layer. */
export interface TiledObject {
  id: number;
  name: string;
  /** Tiled "class" field (used to be called "type" in older Tiled versions). */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  properties?: TiledProperty[];
  /** True if the object is a single point (no width/height). */
  point?: boolean;
  /** True if the object is an ellipse. */
  ellipse?: boolean;
  /** Polygon points, relative to object origin. */
  polygon?: Array<{ x: number; y: number }>;
  /** Polyline points, relative to object origin. */
  polyline?: Array<{ x: number; y: number }>;
  /** GID for tile objects (the object is a placed tile). */
  gid?: number;
}

// ---------------------------------------------------------------------------
// Tile definitions (per-tile metadata in a tileset)
// ---------------------------------------------------------------------------

/** Per-tile metadata entry inside a tileset — carries custom properties. */
export interface TiledTileDefinition {
  /** Local tile ID within the tileset (0-based). */
  id: number;
  properties?: TiledProperty[];
  /** Animation frames (future use). */
  animation?: Array<{ tileid: number; duration: number }>;
  /** Collision object group for this tile (future use). */
  objectgroup?: TiledLayer;
}

// ---------------------------------------------------------------------------
// Tilesets
// ---------------------------------------------------------------------------

/**
 * A fully-resolved tileset — all fields present.
 * After loading, every TiledTilesetRef is resolved to this type.
 */
export interface TiledTileset {
  /** Global ID of the first tile in this tileset. */
  firstgid: number;
  name: string;
  /** Relative path to the tileset source image (e.g. "../tilesets/dungeon.png"). */
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  /** Outer margin around the image edge (px). */
  margin: number;
  /** Spacing between tiles (px). */
  spacing: number;
  /** Per-tile metadata (only tiles that have custom properties or animations). */
  tiles?: TiledTileDefinition[];
  properties?: TiledProperty[];
}

/**
 * Tileset reference as it appears in the map JSON before resolution.
 * - Embedded: all TiledTileset fields are present inline.
 * - External: only firstgid + source are present; the loader fetches the .tsj.
 */
export type TiledTilesetRef =
  | TiledTileset
  | { firstgid: number; source: string };

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * A single layer in the map.  The `type` discriminates what fields are present:
 * - "tilelayer":   data (GID array), width, height
 * - "objectgroup": objects array
 * - "imagelayer":  image path (decorative, not parsed for game logic)
 * - "group":       nested layers array
 */
export interface TiledLayer {
  id: number;
  name: string;
  type: "tilelayer" | "objectgroup" | "imagelayer" | "group";
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  /** Width in tiles (tilelayer only). */
  width?: number;
  /** Height in tiles (tilelayer only). */
  height?: number;
  /**
   * Flat row-major GID array (tilelayer only, when format is CSV).
   * Index i → tile at (i % mapWidth, floor(i / mapWidth)).
   * GID 0 means empty cell.
   */
  data?: number[];
  /** Objects in an objectgroup layer. */
  objects?: TiledObject[];
  /** Nested layers (group layer only). */
  layers?: TiledLayer[];
  properties?: TiledProperty[];
  /** Pixel offset for parallax (future use). */
  offsetx?: number;
  offsety?: number;
}

// ---------------------------------------------------------------------------
// Map (top-level)
// ---------------------------------------------------------------------------

/** The top-level Tiled map document, as exported to JSON (.tmj). */
export interface TiledMap {
  version: string;
  /** Tiled application version that wrote this file (e.g. "1.11.0"). */
  tiledversion: string;
  orientation: "orthogonal" | "isometric" | "staggered" | "hexagonal";
  renderorder: "right-down" | "right-up" | "left-down" | "left-up";
  /** Map width in tiles. */
  width: number;
  /** Map height in tiles. */
  height: number;
  /** Tile width in pixels (e.g. 32). */
  tilewidth: number;
  /** Tile height in pixels (e.g. 32). */
  tileheight: number;
  /** If true the map has no fixed size (not supported by this loader). */
  infinite: boolean;
  layers: TiledLayer[];
  /** Tileset references — may be embedded or external until resolved by the loader. */
  tilesets: TiledTilesetRef[];
  /** Map-level custom properties (battleId, seed, enginePhase, etc.). */
  properties?: TiledProperty[];
  /** Background color as "#rrggbb" hex string (optional). */
  backgroundcolor?: string;
  nextlayerid?: number;
  nextobjectid?: number;
}

// ---------------------------------------------------------------------------
// Resolved map (post-loader)
// ---------------------------------------------------------------------------

/**
 * A TiledMap where every TiledTilesetRef has been resolved to a full TiledTileset.
 * The loader always returns this type.
 */
export interface ResolvedTiledMap extends Omit<TiledMap, "tilesets"> {
  tilesets: TiledTileset[];
}
