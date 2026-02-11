# Tiled Map Editor Integration Plan

**Version:** 1.0
**Date:** February 10, 2026
**Status:** Proposed
**Companion Documents:** DESIGNER_TOOLS_PLAN.md, TYPESCRIPT_TECHNICAL_SPEC.md

---

## Summary

Replace the procedural colored-rectangle map renderer with real tile art authored
in the [Tiled Map Editor](https://www.mapeditor.org/). Tiled maps become the
primary way to build battle arenas, while the existing hand-written JSON scenario
format remains supported as a fallback. The engine itself (`BattleState`,
`MapState`, movement, LoS/LoE) is intentionally untouched; Tiled integration
lives entirely in the **IO** and **Rendering** layers.

---

## Goals and Non-Goals

### Goals

1. Author battle maps visually in Tiled with real tileset art.
2. Encode game-significant terrain data (blocked, difficult terrain, elevation,
   hazard zones, spawn points) as Tiled custom properties and object layers.
3. Render tile art on the PixiJS canvas using GPU-batched tile draws.
4. Preserve full backward compatibility with existing JSON scenarios.
5. Keep the engine, grid, and rules layers completely unaware of Tiled.

### Non-Goals

- Isometric or hex grids (orthogonal only, matching Pathfinder 2e).
- Runtime map editing inside the browser (Tiled is the authoring tool).
- Animated tiles or parallax layers (future work).
- Auto-tiling or procedural generation.

---

## Architecture Overview

```
                     Tiled Map Editor
                           |
                     Export as JSON (.tmj)
                           |
                           v
  ┌────────────────────────────────────────────┐
  │              src/io/tiledLoader.ts          │
  │  fetch .tmj  ->  parse  ->  TiledMap type  │
  └──────────┬──────────────────┬──────────────┘
             |                  |
             v                  v
  ┌──────────────────┐  ┌─────────────────────────┐
  │  mapDataBridge   │  │  tiledTilemapRenderer    │
  │  (IO layer)      │  │  (Rendering layer)       │
  │                  │  │                           │
  │  TiledMap ->     │  │  TiledMap ->              │
  │    MapState      │  │    CompositeTilemap       │
  │    + spawns      │  │    (GPU-batched draws)    │
  │    + hazards     │  │                           │
  │    + objectives  │  │  Replaces renderTileMap() │
  │    + metadata    │  │  inside the map layer     │
  └──────────────────┘  └─────────────────────────┘
             |
             v
     Existing engine
     (BattleState, MapState unchanged)
```

Two clean boundaries:

- **IO boundary** — `tiledLoader.ts` parses the raw JSON, `mapDataBridge.ts`
  converts it into the same `MapState` and scenario structures the engine
  already consumes. No engine changes needed.
- **Rendering boundary** — `tiledTilemapRenderer.ts` replaces
  `tileRenderer.ts` when a Tiled map is loaded. It uses `@pixi/tilemap` for
  rendering and the existing PixiJS layer hierarchy (`pixiApp.ts` map layer).
  The camera, sprite manager, and effect renderer are unchanged.

---

## Tiled Authoring Conventions

These conventions define how a map author structures a `.tmj` file for the game.

### Map-Level Custom Properties

| Property       | Type   | Required | Description                               |
|----------------|--------|----------|-------------------------------------------|
| `battleId`     | string | yes      | Unique scenario identifier                |
| `seed`         | int    | no       | RNG seed (default: 0)                     |
| `enginePhase`  | int    | no       | Rules phase (default: 7)                  |

### Tileset Tile Properties

Set on individual tiles in the Tiled tileset editor. Every placed instance of
that tile inherits these values.

| Property    | Type   | Default    | Description                                   |
|-------------|--------|------------|-----------------------------------------------|
| `blocked`   | bool   | false      | Impassable terrain (walls, pits, pillars)     |
| `moveCost`  | int    | 1          | Movement cost in 5-ft steps (2 = difficult)   |
| `terrain`   | string | `"floor"`  | Terrain tag (floor, water, lava, ice, forest) |
| `elevation` | int    | 0          | Height in 5-ft increments (future: LoS/LoE)   |
| `cover`     | string | `"none"`   | Cover grade: none, lesser, standard, greater  |

### Required Tile Layers

| Layer name | Purpose                                 |
|------------|-----------------------------------------|
| `Ground`   | Base floor tiles (every cell filled)    |
| `Walls`    | Obstacle/wall tiles (sparse, overlaid)  |

Additional decorative tile layers (e.g. `Decor`, `Overlay`) are rendered but
have no mechanical effect unless tiles carry custom properties.

### Object Layers

Object layers encode game-significant entities as rectangles, points, or
polygons with custom properties. The `type` field on each object determines
how the loader interprets it.

#### `Spawns` layer

| Object field | Type   | Description                            |
|--------------|--------|----------------------------------------|
| `name`       | string | Unit ID (e.g. `"pc_fighter"`)          |
| `type`       | string | Must be `"spawn"`                      |
| `x`, `y`     | float  | Pixel position (divided by tile size to get grid coords) |

Custom properties on each spawn object:

| Property            | Type   | Required | Description                         |
|---------------------|--------|----------|-------------------------------------|
| `team`              | string | yes      | pc, enemy, ally, neutral            |
| `hp`                | int    | yes      | Starting hit points                 |
| `initiative`        | int    | yes      | Turn order initiative               |
| `attackMod`         | int    | yes      | Attack modifier                     |
| `ac`                | int    | yes      | Armor class                         |
| `damage`            | string | yes      | Dice notation (e.g. `"1d8+4"`)     |
| `attackDamageType`  | string | no       | Damage type (default: `"physical"`) |
| `fortitude`         | int    | no       | Fortitude save modifier             |
| `reflex`            | int    | no       | Reflex save modifier                |
| `will`              | int    | no       | Will save modifier                  |
| `tempHp`            | int    | no       | Temporary hit points                |

#### `Hazards` layer

| Object field     | Type   | Description                    |
|------------------|--------|--------------------------------|
| `name`           | string | Hazard identifier              |
| `type`           | string | Must be `"hazard"`             |
| `x`, `y`         | float  | Top-left pixel position        |
| `width`, `height`| float  | Zone size in pixels            |

Custom properties:

| Property        | Type   | Description                             |
|-----------------|--------|-----------------------------------------|
| `element`       | string | Damage type (fire, cold, acid, etc.)    |
| `damagePerTurn` | int    | Damage dealt per turn inside the zone   |
| `dc`            | int    | Save DC to avoid/reduce damage          |
| `saveType`      | string | Fortitude, Reflex, or Will              |

#### `Objectives` layer

| Object field | Type   | Description                                  |
|--------------|--------|----------------------------------------------|
| `name`       | string | Objective identifier                         |
| `type`       | string | Objective type: `"reach_tile"`, `"defend"`, etc. |
| `x`, `y`     | float  | Target tile (pixel coords / tile size)       |

Custom properties:

| Property  | Type   | Description                                  |
|-----------|--------|----------------------------------------------|
| `unitId`  | string | Unit that must satisfy the objective         |
| `label`   | string | Human-readable objective description         |

---

## New Dependency

```
npm install @pixi/tilemap@^5
```

`@pixi/tilemap` v5.x is the official PixiJS tilemap renderer compatible with
PixiJS 8.x. It provides `CompositeTilemap`, which GPU-batches tile sprite
draws into a single draw call per tileset texture. No other new dependencies.

---

## Implementation Phases

### Phase 1 — Tiled Type Definitions and JSON Loader

**New file:** `src/io/tiledTypes.ts`

TypeScript interfaces for the Tiled JSON map format. These mirror the
[official Tiled JSON spec](https://doc.mapeditor.org/en/stable/reference/json-map-format/)
and are used by both the loader and the bridge.

```typescript
/** Top-level Tiled map. */
export interface TiledMap {
  version: string;
  tiledversion: string;
  orientation: "orthogonal";
  renderorder: string;
  width: number;             // map width in tiles
  height: number;            // map height in tiles
  tilewidth: number;         // pixels per tile (e.g. 32 or 64)
  tileheight: number;
  infinite: boolean;
  layers: TiledLayer[];
  tilesets: TiledTilesetRef[];
  properties?: TiledProperty[];
}

/** A layer — tile grid, object group, image, or group. */
export interface TiledLayer {
  id: number;
  name: string;
  type: "tilelayer" | "objectgroup" | "imagelayer" | "group";
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data?: number[];            // GID flat array (tilelayer only)
  objects?: TiledObject[];    // objectgroup only
  layers?: TiledLayer[];      // group only (nested)
  properties?: TiledProperty[];
}

/** An embedded tileset (after resolving any external .tsj reference). */
export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;              // relative path to tileset PNG
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin: number;
  spacing: number;
  tiles?: TiledTileDefinition[];
}

/**
 * Tileset reference as it appears in the map JSON.
 * May be embedded (all fields present) or external (only firstgid + source).
 */
export type TiledTilesetRef =
  | TiledTileset
  | { firstgid: number; source: string };

/** Per-tile metadata in a tileset (custom properties on specific tile IDs). */
export interface TiledTileDefinition {
  id: number;                  // local tile ID within the tileset
  properties?: TiledProperty[];
}

/** A free-form object in an object layer. */
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  properties?: TiledProperty[];
  point?: boolean;
  ellipse?: boolean;
  polygon?: Array<{ x: number; y: number }>;
}

/** A custom property on any Tiled element. */
export interface TiledProperty {
  name: string;
  type: "string" | "int" | "float" | "bool" | "color" | "file" | "object" | "class";
  value: unknown;
  propertytype?: string;
}
```

**New file:** `src/io/tiledLoader.ts`

Fetches a `.tmj` file, resolves external tileset references, and returns a
fully-resolved `TiledMap`. Also provides helpers for GID resolution and
property extraction.

Key functions:

```
loadTiledMap(url: string): Promise<TiledMap>
resolveTileGid(gid: number, tilesets: TiledTileset[]): { tileset, localId } | null
getProperties(props?: TiledProperty[]): Record<string, unknown>
getTileProperties(tileset: TiledTileset, localId: number): Record<string, unknown>
```

GID resolution must strip the upper three flip-flag bits
(`0x80000000`, `0x40000000`, `0x20000000`) before lookup.

**Tests:** `src/io/__tests__/tiledLoader.test.ts`
- Parses a minimal embedded-tileset map.
- Resolves GIDs across multiple tilesets.
- Strips flip flags correctly.
- Returns empty properties when none are defined.

---

### Phase 2 — Map Data Bridge (Tiled -> Engine)

**New file:** `src/io/mapDataBridge.ts`

Converts a parsed `TiledMap` into the structures the engine already consumes.
This is the semantic translation layer — it understands the authoring
conventions (layer names, object types, property names) and maps them to
engine types.

Key functions:

```
extractMapState(tiledMap: TiledMap): MapState
extractSpawnPoints(tiledMap: TiledMap): SpawnPointData[]
extractHazardZones(tiledMap: TiledMap): HazardZoneData[]
extractObjectives(tiledMap: TiledMap): ObjectiveData[]
extractMapProperties(tiledMap: TiledMap): MapProperties
buildScenarioFromTiledMap(tiledMap: TiledMap): Record<string, unknown>
```

#### `extractMapState`

Scans all tile layers. For each tile, resolves its GID, looks up the tile's
custom properties in the tileset, and checks for `blocked: true`. Returns:

```typescript
{
  width: tiledMap.width,
  height: tiledMap.height,
  blocked: [ /* [x,y] pairs where any tile has blocked=true */ ]
}
```

This produces a `MapState` that plugs directly into `battleStateFromScenario`
with zero engine changes.

#### Future: `extractTerrainGrid`

When the engine later supports terrain costs, this function builds a
`number[][]` grid from `moveCost` tile properties. Not implemented in Phase 2
but the tile properties are already defined so map authors can start tagging
tiles now.

#### `extractSpawnPoints`

Finds the `Spawns` object layer. For each object with `type === "spawn"`,
reads the object's `name` as the unit ID, divides pixel coords by tile size
to get grid position, and reads custom properties (`team`, `hp`, `ac`, etc.)
to build a unit definition compatible with the existing scenario unit format.

```typescript
interface SpawnPointData {
  id: string;
  team: string;
  position: [number, number];
  hp: number;
  initiative: number;
  attackMod: number;
  ac: number;
  damage: string;
  attackDamageType: string;
  fortitude: number;
  reflex: number;
  will: number;
  tempHp: number;
}
```

#### `buildScenarioFromTiledMap`

Top-level convenience: takes a `TiledMap` and returns a scenario-shaped
plain object (identical structure to the hand-written JSON files) that can
be fed directly into the existing `validateScenario` +
`battleStateFromScenario` pipeline. This means every downstream system —
validation, turn order, command dispatch, event logging — works unchanged.

```typescript
const tiledMap = await loadTiledMap("/maps/dungeon_01.tmj");
const scenarioData = buildScenarioFromTiledMap(tiledMap);
validateScenario(scenarioData);
const battleState = battleStateFromScenario(scenarioData);
```

**Tests:** `src/io/__tests__/mapDataBridge.test.ts`
- Blocked tiles extracted from tile properties.
- Spawn points extracted with correct grid coords.
- Pixel-to-tile rounding is correct for Tiled's top-left origin.
- Missing optional properties fall back to defaults.
- Output validates against `validateScenario`.

---

### Phase 3 — Tileset Asset Pipeline

**New directory:** `public/tilesets/`

Tileset PNG images go here. These are the same images referenced by the Tiled
project. Example layout:

```
public/
├── tilesets/
│   ├── dungeon_floor.png      # 256x256, 8x8 tiles at 32px
│   ├── dungeon_walls.png      # 256x128, 8x4 tiles at 32px
│   └── terrain_props.png      # decorative objects
├── maps/
│   ├── dungeon_01.tmj         # exported Tiled map (JSON)
│   └── dungeon_01.tmj         # ...more maps
└── scenarios/
    └── smoke/                 # existing hand-written scenarios (unchanged)
```

**New directory:** `public/maps/`

Exported `.tmj` map files. Tiled's JSON export with "CSV" tile layer format
(produces a flat integer array, not base64).

**Tileset image loading** uses the existing PixiJS `Assets` API:

```typescript
import { Assets, Texture, Rectangle } from "pixi.js";

// Load the tileset source image once
const baseTexture = await Assets.load("tilesets/dungeon_floor.png");

// Slice individual tile textures from the tileset grid
function sliceTileTextures(
  source: Texture,
  tileset: TiledTileset,
): Map<number, Texture> {
  const textures = new Map<number, Texture>();
  for (let localId = 0; localId < tileset.tilecount; localId++) {
    const col = localId % tileset.columns;
    const row = Math.floor(localId / tileset.columns);
    textures.set(tileset.firstgid + localId, new Texture({
      source: source.source,
      frame: new Rectangle(
        tileset.margin + col * (tileset.tilewidth + tileset.spacing),
        tileset.margin + row * (tileset.tileheight + tileset.spacing),
        tileset.tilewidth,
        tileset.tileheight,
      ),
    }));
  }
  return textures;
}
```

Image paths in the `.tmj` are relative to the map file. The loader resolves
them against `public/` for Vite's static serving.

---

### Phase 4 — Tiled Tilemap Renderer

**New file:** `src/rendering/tiledTilemapRenderer.ts`

Replaces `renderTileMap()` when a Tiled map is active. Uses
`@pixi/tilemap`'s `CompositeTilemap` for GPU-batched rendering.

```typescript
import { Container } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { TiledMap, TiledTileset } from "../io/tiledTypes";

let _tilemap: CompositeTilemap | null = null;
let _hoverGraphic: Graphics | null = null;

export async function renderTiledMap(
  parent: Container,
  tiledMap: TiledMap,
  tileTextures: Map<number, Texture>,
): Promise<void> {
  // Tear down previous
  if (_tilemap) {
    parent.removeChild(_tilemap);
    _tilemap.destroy();
  }

  _tilemap = new CompositeTilemap();
  _tilemap.label = "tiled_map";

  // Render each visible tile layer, bottom to top
  for (const layer of tiledMap.layers) {
    if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;

    for (let i = 0; i < layer.data.length; i++) {
      const rawGid = layer.data[i];
      const gid = rawGid & 0x1fffffff;  // strip flip flags
      if (gid === 0) continue;           // empty cell

      const texture = tileTextures.get(gid);
      if (!texture) continue;

      const x = (i % tiledMap.width) * tiledMap.tilewidth;
      const y = Math.floor(i / tiledMap.width) * tiledMap.tileheight;
      _tilemap.tile(texture, x, y);
    }
  }

  parent.addChild(_tilemap);

  // Reuse the same hover-highlight approach as the original renderer
  _hoverGraphic = new Graphics();
  _hoverGraphic.label = "hover";
  _hoverGraphic.visible = false;
  parent.addChild(_hoverGraphic);
}
```

**Grid overlay** (toggle-able): A thin semi-transparent grid drawn on top of
the tile art, using the same logic as the current `renderTileMap` grid-line
code. This helps players count squares. Controlled by a `showGrid` flag in
the battle store.

**`setHoverTile`** is shared unchanged — it works in pixel space via
`TILE_SIZE` and doesn't care what's underneath.

**TILE_SIZE mapping:** The Tiled map's `tilewidth`/`tileheight` (e.g. 32px)
may differ from the engine's `TILE_SIZE` (64px). The renderer applies a
uniform scale factor: `scaleFactor = TILE_SIZE / tiledMap.tilewidth`. The
`CompositeTilemap` container's `scale` is set to this factor. This means:
- The camera, hover highlight, and unit sprites continue to work in
  TILE_SIZE-pixel space.
- Tile art renders at its native resolution, scaled up or down.
- No coordinate translation needed anywhere else.

---

### Phase 5 — Scenario Loader Integration

**Modified file:** `src/io/scenarioLoader.ts`

Add a parallel loading path that detects Tiled maps:

```typescript
export async function loadScenario(
  url: string,
): Promise<{ battle: BattleState; tiledMap?: TiledMap }> {
  const response = await fetch(url);
  const data = await response.json();

  // Detect format: Tiled maps have "tiledversion"; scenarios have "battle_id"
  if ("tiledversion" in data) {
    const tiledMap = parseTiledMap(data);   // from tiledLoader.ts
    const scenarioData = buildScenarioFromTiledMap(tiledMap);
    validateScenario(scenarioData);
    return {
      battle: battleStateFromScenario(scenarioData),
      tiledMap,
    };
  }

  // Existing path: hand-written JSON scenario
  validateScenario(data);
  return { battle: battleStateFromScenario(data) };
}
```

When `tiledMap` is present in the result, the UI layer uses
`renderTiledMap()` instead of `renderTileMap()`.

**Modified file:** `src/store/battleStore.ts`

Add an optional `tiledMap: TiledMap | null` field to the store. Set when a
Tiled map is loaded, null for legacy scenarios. The rendering code checks
this to decide which renderer to call.

**Modified file:** `src/ui/App.tsx`

In the battle-load effect, branch on whether `tiledMap` is present:

```typescript
if (tiledMap) {
  const textures = await loadTilesetTextures(tiledMap);
  await renderTiledMap(layers.map, tiledMap, textures);
} else {
  renderTileMap(layers.map, battle.battleMap);
}
```

---

### Phase 6 — UI: Map Browser and Designer Integration

**Modified file:** `src/ui/ScenarioLoader.tsx`

Extend the scenario file browser to also list `.tmj` files from `public/maps/`.
The load button calls the unified `loadScenario()` which auto-detects the
format.

**Modified file:** `src/ui/designer/ScenarioInspector.tsx`

When inspecting a Tiled-sourced battle, show:
- Source `.tmj` file path
- Map dimensions and tile size
- Layer list with tile/object counts
- Tileset names and tile counts
- Extracted spawn points, hazards, objectives
- "Open in Tiled" hint (shows the file path to open)

This is read-only — editing happens in Tiled. The designer tools focus on
scenario properties that live outside the map (commands, enemy policy,
content packs).

---

## File Inventory

### New Files

| Path                                        | Purpose                                  |
|---------------------------------------------|------------------------------------------|
| `src/io/tiledTypes.ts`                      | TypeScript interfaces for Tiled JSON     |
| `src/io/tiledLoader.ts`                     | Fetch and parse `.tmj` files             |
| `src/io/mapDataBridge.ts`                   | Convert TiledMap to MapState + spawns    |
| `src/rendering/tiledTilemapRenderer.ts`     | GPU-batched tile rendering via @pixi/tilemap |
| `src/io/__tests__/tiledLoader.test.ts`      | Loader unit tests                        |
| `src/io/__tests__/mapDataBridge.test.ts`    | Bridge unit tests                        |
| `src/rendering/__tests__/tiledTilemapRenderer.test.ts` | Renderer unit tests           |
| `public/maps/`                              | Directory for exported `.tmj` files      |
| `public/tilesets/`                          | Directory for tileset PNG images         |

### Modified Files

| Path                                    | Change                                     |
|-----------------------------------------|--------------------------------------------|
| `src/io/scenarioLoader.ts`             | Add Tiled format detection branch          |
| `src/store/battleStore.ts`             | Add optional `tiledMap` to store state     |
| `src/ui/App.tsx`                       | Branch rendering on Tiled vs legacy        |
| `src/ui/ScenarioLoader.tsx`            | List `.tmj` files in browser               |
| `src/ui/designer/ScenarioInspector.tsx`| Show Tiled map metadata when applicable    |
| `package.json`                         | Add `@pixi/tilemap@^5` dependency         |

### Unchanged (explicitly)

| Path                          | Why untouched                                     |
|-------------------------------|---------------------------------------------------|
| `src/engine/state.ts`         | `MapState` interface is sufficient as-is          |
| `src/engine/reducer.ts`       | Engine doesn't know about tiles                   |
| `src/grid/map.ts`             | `isBlocked` uses `MapState.blocked` — still works |
| `src/grid/movement.ts`        | `canStepTo` uses `isBlocked` — still works        |
| `src/grid/los.ts`             | LoS uses blocked set — still works                |
| `src/grid/loe.ts`             | LoE uses blocked set — still works                |
| `src/grid/areas.ts`           | Area calculations are grid-pure                   |
| `src/rules/*`                 | All rules are state-driven, not map-format-aware  |
| `src/effects/*`               | Effects operate on units, not tiles                |
| `src/rendering/spriteManager.ts`   | Units still position at `x * TILE_SIZE`      |
| `src/rendering/cameraController.ts`| Camera is tile-size-based — unchanged         |
| `src/rendering/effectRenderer.ts`  | Damage numbers are unit-anchored              |
| `src/rendering/tileRenderer.ts`    | Kept for legacy scenarios; not deleted        |
| `public/scenarios/smoke/*`         | Existing scenarios continue to work           |

---

## Tiled Project Setup Guide

For map authors setting up their Tiled environment.

### 1. Create a Tiled Project

Open Tiled, **File > New > New Project**. Save the `.tiled-project` file at
the repository root (or a `tiled/` subdirectory — it's gitignored by default).

### 2. Configure Custom Types

**Project > Custom Types**, add:

**Enum: `Team`**
Values: `pc`, `enemy`, `ally`, `neutral`

**Enum: `SaveType`**
Values: `Fortitude`, `Reflex`, `Will`

**Enum: `CoverGrade`**
Values: `none`, `lesser`, `standard`, `greater`

These enums constrain property values in the Tiled UI, preventing typos.

### 3. Create a Tileset

**File > New > New Tileset**.
- Type: "Based on Tileset Image"
- Image: point to `public/tilesets/your_tileset.png`
- Tile width/height: 32px (or whatever your art uses)
- Save as `.tsj` alongside the image

Select individual tiles and set custom properties:
- Wall tiles: `blocked = true`
- Forest tiles: `moveCost = 2`, `terrain = "forest"`, `cover = "lesser"`
- Water tiles: `blocked = true`, `terrain = "water"` (or `moveCost = 3` if
  swimmable)

### 4. Build a Map

**File > New > New Map**.
- Orientation: Orthogonal
- Tile size: must match your tileset
- Map size: your battle arena dimensions

Create layers in this order (bottom to top):
1. `Ground` (tile layer) — fill every cell with floor tiles
2. `Walls` (tile layer) — place wall/obstacle tiles
3. `Decor` (tile layer, optional) — decorative overlays
4. `Spawns` (object layer) — place rectangle objects for unit spawn points
5. `Hazards` (object layer, optional) — rectangle zones for hazard areas
6. `Objectives` (object layer, optional) — point/rect objects for goals

Set map-level custom properties: `battleId`, `seed`.

### 5. Export

**File > Export As** → choose JSON format (`.tmj`).
- Tile Layer Format: CSV (produces a flat integer array, easiest to parse)
- Save to `public/maps/your_map.tmj`

---

## Coordinate System Notes

Tiled uses a pixel-based coordinate system with the origin at the top-left.
The game engine uses a tile-based integer grid, also origin top-left.

**Tile layers:** The `data` array is row-major, left-to-right, top-to-bottom.
Index `i` maps to grid position:
```
x = i % map.width
y = Math.floor(i / map.width)
```

**Object layers:** Object positions (`x`, `y`) are in pixels. To convert to
grid coordinates:
```
gridX = Math.floor(obj.x / map.tilewidth)
gridY = Math.floor(obj.y / map.tileheight)
```

**Caveat:** Tiled's object `y` for tile objects is at the *bottom* of the
tile, not the top. For rectangle objects (which we use for spawns and zones),
`y` is the top edge. The bridge code handles both cases.

---

## Scale Factor Handling

The Tiled map's native tile size (e.g. 32px art) may differ from the engine's
`TILE_SIZE` constant (currently 64px). The renderer handles this with a
uniform scale:

```
scaleFactor = TILE_SIZE / tiledMap.tilewidth
```

The `CompositeTilemap` container's `scale` is set to this value. Everything
above — camera, hover highlight, unit sprites — continues to operate in
`TILE_SIZE`-pixel space. No math changes anywhere else in the codebase.

If tile art is authored at 64px to match `TILE_SIZE`, the scale factor is 1
and there is no scaling at all.

---

## Testing Strategy

### Unit Tests

- **tiledLoader.test.ts** — Parse minimal map JSON fixtures. Verify GID
  resolution, flip-flag stripping, property extraction, external tileset
  resolution.
- **mapDataBridge.test.ts** — Feed parsed TiledMap fixtures through the
  bridge. Verify `MapState.blocked` matches tiles with `blocked: true`.
  Verify spawn point grid coords are correct. Verify the output passes
  `validateScenario()`.
- **tiledTilemapRenderer.test.ts** — Verify that `CompositeTilemap` is
  populated with the correct number of tiles. Verify scale factor is applied.
  (PixiJS tests use headless/mock context.)

### Integration Tests

- Load a `.tmj` fixture through the full pipeline: `loadTiledMap` →
  `buildScenarioFromTiledMap` → `validateScenario` → `battleStateFromScenario`.
  Run a few commands against the resulting `BattleState` to confirm the engine
  works identically.
- Verify that loading a legacy JSON scenario still works unchanged (backward
  compatibility).

### Manual QA

- Open a Tiled-authored map in the browser. Verify tiles render correctly.
- Place a spawn point in Tiled, reload, confirm the unit appears at the right
  grid cell.
- Mark a tile as `blocked: true` in Tiled, reload, confirm the unit cannot
  move onto it.
- Load a legacy `smoke/` scenario, confirm it still renders with the old
  colored-rectangle renderer.

---

## Migration Path

Tiled maps are additive. No existing scenarios break.

1. **Phase 1-4:** Build the loader and renderer. Test with a handcrafted
   `.tmj` fixture and a placeholder tileset.
2. **Phase 5:** Wire into the scenario loader. Both formats coexist.
3. **Phase 6:** Update the UI to browse both formats.
4. **Future:** Gradually author new scenarios as Tiled maps. Old `smoke/`
   scenarios remain as regression tests forever.

There is no "big bang" cutover. The two formats coexist indefinitely.

---

## Future Work (Out of Scope)

These are deferred but the design accommodates them:

- **Terrain costs / difficult terrain** — `moveCost` tile property is already
  defined. When `canStepTo` is extended to check terrain cost, the data is
  already in the map.
- **Elevation and LoS** — `elevation` tile property is defined. LoS/LoE
  calculations can incorporate height differences later.
- **Cover from terrain** — `cover` tile property is defined. The existing
  LoE cover system can read terrain-based cover grades.
- **Animated tiles** — Tiled supports tile animations in the tileset. The
  renderer could animate them via PixiJS ticker updates.
- **Multiple tilesets per map** — Already supported by the GID resolution
  logic. Multiple tileset images are loaded and their textures merged into
  one lookup map.
- **Fog of war** — Object layer or computed overlay based on LoS from party
  units.
- **Tiled project file (`.tiled-project`)** — Could be committed to the repo
  with custom type definitions, so all map authors share the same property
  schemas.
