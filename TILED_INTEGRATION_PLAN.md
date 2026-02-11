# Tiled Map Editor Integration

**Version:** 1.1
**Date:** February 10, 2026
**Status:** Implemented
**Companion Documents:** DESIGNER_TOOLS_PLAN.md, TYPESCRIPT_TECHNICAL_SPEC.md

---

## Summary

Tiled maps are the primary way to build battle arenas. The Tiled Map Editor
is used to author maps visually; the game loads `.tmj` exports, renders tile
art via `@pixi/tilemap`, and drives the engine from embedded spawn/terrain
data. The legacy hand-written JSON scenario format is preserved as a fallback.

The engine itself (`BattleState`, `MapState`, movement, LoS/LoE) is
intentionally untouched; Tiled integration lives entirely in the **IO** and
**Rendering** layers.

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
draws into a single draw call per tileset texture.

---

## Implementation

### ✅ Phase 1 — Tiled Type Definitions and JSON Loader

**File:** `src/io/tiledTypes.ts`

TypeScript interfaces for the Tiled JSON map format (mirrors the
[official Tiled JSON spec](https://doc.mapeditor.org/en/stable/reference/json-map-format/)).
Key types: `TiledMap`, `TiledLayer`, `TiledTileset`, `TiledTilesetRef`,
`TiledTileDefinition`, `TiledObject`, `TiledProperty`.

Also defines `ResolvedTiledMap` (all tileset refs resolved to full
`TiledTileset` objects) which is what the rest of the codebase consumes.

**File:** `src/io/tiledLoader.ts`

Fetches a `.tmj` file, resolves external `.tsj` tileset references, and
returns a `ResolvedTiledMap`. Key functions:

```
loadTiledMap(url: string): Promise<ResolvedTiledMap>
resolveTileGid(gid: number, tilesets: TiledTileset[]): { tileset, localId } | null
getProperties(props?: TiledProperty[]): Record<string, unknown>
getTileProperties(tileset: TiledTileset, localId: number): Record<string, unknown>
```

GID resolution strips the upper three flip-flag bits
(`0x80000000`, `0x40000000`, `0x20000000`) before lookup.

**Tests:** `src/io/__tests__/tiledLoader.test.ts`

---

### ✅ Phase 2 — Map Data Bridge (Tiled → Engine)

**File:** `src/io/mapDataBridge.ts`

Converts a parsed `ResolvedTiledMap` into the structures the engine already
consumes. Key functions:

```
extractMapState(tiledMap: ResolvedTiledMap): MapState
extractSpawnPoints(tiledMap: ResolvedTiledMap): SpawnPointData[]
extractHazardZones(tiledMap: ResolvedTiledMap): HazardZoneData[]
extractObjectives(tiledMap: ResolvedTiledMap): ObjectiveData[]
buildScenarioFromTiledMap(tiledMap: ResolvedTiledMap): Record<string, unknown>
```

`extractMapState` scans all tile layers, resolves GIDs, checks for
`blocked: true` tile properties, and returns a `MapState` compatible with the
existing engine (`{ width, height, blocked: [x,y][] }`).

`buildScenarioFromTiledMap` produces a scenario-shaped plain object identical
in structure to hand-written JSON files, which can be fed directly into
`validateScenario` + `battleStateFromScenario`.

**Tests:** `src/io/__tests__/mapDataBridge.test.ts`

---

### ✅ Phase 3 — Tileset Asset Pipeline

**Directory:** `public/tilesets/` — tileset PNG images (referenced by `.tmj` files)

**Directory:** `public/maps/` — exported `.tmj` map files

**File:** `src/rendering/tilesetLoader.ts`

Loads tileset images via the PixiJS `Assets` API, slices individual tile
textures using `Texture` + `Rectangle`, and returns a `Map<number, Texture>`
GID lookup.

```typescript
loadTilesetTextures(
  tiledMap: ResolvedTiledMap,
  mapUrl: string,
): Promise<Map<number, Texture>>
```

Image paths in the `.tmj` are relative to the map file. The loader resolves
them against the `mapUrl` base for Vite's static serving.

---

### ✅ Phase 4 — Tiled Tilemap Renderer

**File:** `src/rendering/tiledTilemapRenderer.ts`

Replaces `renderTileMap()` when a Tiled map is active. Uses `@pixi/tilemap`'s
`CompositeTilemap` for GPU-batched rendering (one draw call per tileset
texture).

#### Core rendering pattern

```typescript
_tilemap = new CompositeTilemap();
_tilemap.label = "tiled_map";
_tilemap.scale.set(TILE_SIZE / tiledMap.tilewidth);  // scale container

for (const layer of tiledMap.layers) {
  if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;

  for (let i = 0; i < layer.data.length; i++) {
    const rawGid = layer.data[i];
    const gid = rawGid & 0x1fffffff;  // strip flip flags
    if (gid === 0) continue;

    const texture = tileTextures.get(gid);
    if (!texture) continue;

    // Source-space pixel positions (e.g. col * 32 for a 32-px tileset)
    const x = (i % tiledMap.width) * tiledMap.tilewidth;
    const y = Math.floor(i / tiledMap.width) * tiledMap.tileheight;
    _tilemap.tile(texture, x, y);  // tileWidth/tileHeight intentionally omitted
  }
}

parent.addChild(_tilemap);
```

#### Critical: tileWidth/tileHeight must be omitted

In `@pixi/tilemap` v5, the `tileWidth`/`tileHeight` option controls **both**
the quad vertex size **and** the UV pixel extent in the atlas. Passing
`TILE_SIZE` (64) for a 32-px source frame makes the UV read 64 px from the
atlas starting at `frame.x`, overrunning into the neighbouring tile and
producing a corrupted "checkered weave" pattern.

Omitting the option lets it default to `texture.orig.width/height` (the source
frame size, e.g. 32), which is always correct. Display scaling is handled by
the `CompositeTilemap` container's `scale`, not by the tile option.

#### Grid overlay and hover highlight

Grid lines are drawn on a sibling `Graphics` object in `TILE_SIZE` world-space
(not in source-space), so they align with the camera without any extra scaling.
A second `Graphics` object handles the hover highlight via
`setHoverTileTiled([tx, ty])`.

Both are managed by `updateGridOverlay(showGrid)` and `setHoverTileTiled(pos)`
for lightweight per-frame updates that don't re-render the tilemap.

---

### ✅ Phase 5 — Scenario Loader Integration

**Modified:** `src/ui/ScenarioLoader.tsx`

The scenario browser lists `.tmj` files from `public/maps/` alongside legacy
JSON scenarios from `public/scenarios/`. Selecting a `.tmj` calls
`loadTiledMap(url)` + `buildScenarioFromTiledMap(tiledMap)` +
`battleStateFromScenario(scenarioData)`, then stores the `ResolvedTiledMap`
via `loadBattle(state, enginePhase, tiledMap)`. The URL is also passed up to
`App.tsx` via `onTiledMapUrl` so tileset textures can be resolved relative to
the map file.

**Modified:** `src/store/battleStore.ts`

`tiledMap: ResolvedTiledMap | null` added to the store. Set by
`loadBattle(state, enginePhase, tiledMap)`, cleared by `clearBattle()`.

**Modified:** `src/ui/App.tsx`

The battle render effect branches on `tiledMap`:

```typescript
if (tiledMap && tiledMapUrlRef.current) {
  const textures = await loadTilesetTextures(tiledMap, tiledMapUrlRef.current);
  renderTiledMap(layers.map, tiledMap, textures, showGrid);
} else {
  clearTiledRenderer(layers.map);
  renderTileMap(layers.map, battle.battleMap);
}
```

---

### ✅ Phase 6 — UI: Designer Integration

**Modified:** `src/ui/designer/ScenarioInspector.tsx`

When inspecting a Tiled-sourced battle (`tiledMap` present, no legacy
`scenarioData`), shows:
- Source `.tmj` file path
- Map dimensions and tile size
- Layer list with tile/object counts
- Tileset names and tile counts
- Extracted spawn points (with grid coords) and hazard zones
- "Open in Tiled" hint showing the file path

This view is read-only — editing happens in Tiled.

---

## Coordinate System

Tiled uses pixel-based coordinates with origin at the top-left.
The engine uses integer tile-grid coordinates, same origin.

**Tile layers:** Row-major flat array.
```
x = i % map.width
y = Math.floor(i / map.width)
```

**Object layers:** Pixel coords → grid coords:
```
gridX = Math.floor(obj.x / map.tilewidth)
gridY = Math.floor(obj.y / map.tileheight)
```

Tiled rectangle object `y` is the top edge, so the above formula is correct
for spawn points and hazard zones.

---

## Scale Factor and Camera Alignment

### Scale Factor

The Tiled tileset's native tile size (e.g. 32 px) may differ from the engine's
`TILE_SIZE` constant (64 px). The renderer applies a uniform scale to the
`CompositeTilemap` container:

```
scaleFactor = TILE_SIZE / tiledMap.tilewidth   (e.g. 2.0 for 32-px art)
```

Tile positions are computed in source-pixel space (e.g. `col * 32`). With
the `scale.set(2)` on the container, these map to world-space positions of
`col * 64`, matching where unit sprites are placed (`unit.x * TILE_SIZE`).

### Camera Placement Constraint

**The camera must be applied to `worldContainer` (a child of `app.stage`),
not to `app.stage` directly.** This is required for `@pixi/tilemap` to
produce correct output.

`TilemapPipe` computes:
```
u_proj_trans = proj × uWorldTransformMatrix × tilemap.worldTransform
```

where:
- `uWorldTransformMatrix` = `stage.renderGroup.worldTransform` = stage's own
  local transform (the camera, if applied to stage)
- `tilemap.worldTransform` = composed world transform of the tilemap container,
  which includes ALL ancestor transforms — including the camera if it is on
  `app.stage`

If the camera is on `app.stage`, it appears in **both** terms, being applied
twice to tiles. Sprites are rendered differently (CPU-side `groupTransform`
relative to stage) and only get the camera once, causing tiles to be offset
from sprites.

The fix is to insert a `worldContainer` between `app.stage` and all layers:

```
app.stage (identity — never transformed)
  └─ worldContainer  ← camera pan/zoom applied here
       ├─ mapLayer
       ├─ unitsLayer
       ├─ effectsLayer
       └─ uiLayer
```

With `app.stage` as identity:
- `uWorldTransformMatrix` = identity
- `tilemap.worldTransform` = camera (applied exactly once)
- Sprites: `groupTransform` relative to stage, camera applied exactly once

Both tiles and sprites receive the camera exactly once.

---

## File Inventory

### New Files

| Path                                        | Purpose                                  |
|---------------------------------------------|------------------------------------------|
| `src/io/tiledTypes.ts`                      | TypeScript interfaces for Tiled JSON     |
| `src/io/tiledLoader.ts`                     | Fetch and parse `.tmj` files             |
| `src/io/mapDataBridge.ts`                   | Convert TiledMap to MapState + spawns    |
| `src/rendering/tiledTilemapRenderer.ts`     | GPU-batched tile rendering               |
| `src/rendering/tilesetLoader.ts`            | Load and slice tileset textures          |
| `src/io/__tests__/tiledLoader.test.ts`      | Loader unit tests                        |
| `src/io/__tests__/mapDataBridge.test.ts`    | Bridge unit tests                        |
| `public/maps/`                              | Exported `.tmj` map files                |
| `public/tilesets/`                          | Tileset PNG images                       |

### Modified Files

| Path                                    | Change                                     |
|-----------------------------------------|--------------------------------------------|
| `src/rendering/pixiApp.ts`             | Add `worldContainer` between stage and layers; add `getPixiWorld()` |
| `src/io/scenarioLoader.ts`             | Tiled format support via `loadTiledMap` + `buildScenarioFromTiledMap` |
| `src/store/battleStore.ts`             | Add `tiledMap: ResolvedTiledMap | null` to store |
| `src/ui/App.tsx`                       | Branch rendering on Tiled vs legacy; use `getPixiWorld()` for camera |
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
| `src/effects/*`               | Effects operate on units, not tiles               |
| `src/rendering/spriteManager.ts`   | Units still position at `x * TILE_SIZE`      |
| `src/rendering/cameraController.ts`| Camera is tile-size-based — unchanged         |
| `src/rendering/effectRenderer.ts`  | Damage numbers are unit-anchored              |
| `src/rendering/tileRenderer.ts`    | Kept for legacy scenarios; not deleted        |
| `public/scenarios/smoke/*`         | Existing scenarios continue to work           |

---

## Tiled Project Setup Guide

### 1. Create a Tiled Project

Open Tiled, **File > New > New Project**. Save the `.tiled-project` file at
the repository root.

### 2. Configure Custom Types

**Project > Custom Types**, add:

**Enum: `Team`** — Values: `pc`, `enemy`, `ally`, `neutral`

**Enum: `SaveType`** — Values: `Fortitude`, `Reflex`, `Will`

**Enum: `CoverGrade`** — Values: `none`, `lesser`, `standard`, `greater`

### 3. Create a Tileset

**File > New > New Tileset**.
- Type: "Based on Tileset Image"
- Image: point to `public/tilesets/your_tileset.png`
- Tile width/height: 32px (or whatever your art uses)
- Save as `.tsj` alongside the image

Select individual tiles and set custom properties:
- Wall tiles: `blocked = true`
- Forest tiles: `moveCost = 2`, `terrain = "forest"`, `cover = "lesser"`

### 4. Build a Map

**File > New > New Map**.
- Orientation: Orthogonal
- Tile size: must match your tileset
- Map size: your battle arena dimensions

Create layers in this order (bottom to top):
1. `Ground` (tile layer) — fill every cell with floor tiles
2. `Walls` (tile layer) — place wall/obstacle tiles
3. `Decor` (tile layer, optional) — decorative overlays
4. `Spawns` (object layer) — rectangle objects for unit spawn points
5. `Hazards` (object layer, optional) — rectangle zones
6. `Objectives` (object layer, optional) — point/rect objects for goals

Set map-level custom properties: `battleId`, `seed`.

### 5. Export

**File > Export As** → JSON format (`.tmj`).
- Tile Layer Format: CSV
- Save to `public/maps/your_map.tmj`

---

## Testing Strategy

### Unit Tests (implemented)

- `tiledLoader.test.ts` — Parse map JSON fixtures, GID resolution, flip-flag
  stripping, property extraction, external tileset resolution.
- `mapDataBridge.test.ts` — Bridge output validates against `validateScenario`.
  Blocked tiles match `blocked: true` tile properties. Spawn grid coords correct.

### Manual QA checklist

- [ ] Tiled map renders with correct tile art (no UV corruption / checkered pattern)
- [ ] Tile grid aligns with unit sprites (no offset)
- [ ] Blocked tiles prevent unit movement
- [ ] Grid overlay toggles correctly
- [ ] Hover highlight follows mouse
- [ ] Legacy JSON scenarios still render with colored rectangles
- [ ] Camera pan/zoom works correctly for both map types

---

## Future Work

These are deferred but the design accommodates them:

- **Terrain costs** — `moveCost` tile property is defined. Engine extension needed.
- **Elevation and LoS** — `elevation` tile property is defined.
- **Cover from terrain** — `cover` tile property is defined.
- **Animated tiles** — Tiled supports tile animations; renderer could animate via ticker.
- **Fog of war** — Object layer or computed LoS overlay.
- **Tiled project file** — Commit `.tiled-project` with shared custom type definitions.
