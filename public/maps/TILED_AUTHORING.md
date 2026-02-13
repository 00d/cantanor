# Cantanor — Tiled Map Authoring Guide

This document explains how to create and configure Tiled Map Editor (`.tmj`) maps for
Cantanor.  The engine reads custom properties from tile definitions, object layers, and
map-level metadata to build a complete `BattleState` without any hand-written scenario
JSON.

---

## Prerequisites

- [Tiled Map Editor](https://www.mapeditor.org/) 1.10 or later
- Export format: **JSON** (`.tmj`)  — _not_ XML.  Save as `.tmj` directly, or export via
  File → Export As.
- Orthogonal orientation, right-down render order.
- Tile size: **32 × 32 px** (matches the engine's `TILE_SIZE` constant).

---

## Required Map-Level Properties

Set these under **Map → Map Properties** in the Tiled editor.

| Property | Type | Required | Description |
|---|---|---|---|
| `battleId` | string | **yes** | Unique identifier for this battle. Shown in the UI. |
| `seed` | int | no | RNG seed (default `0`). Use a fixed value for reproducible tests. |
| `enginePhase` | int | no | Minimum engine phase required (default `7`). |

The engine will throw an error at load time if `battleId` is missing.

---

## Layer Stack

Layers are processed top-to-bottom for rendering and bottom-to-top for property
extraction (higher layers override lower layers for numeric properties; `blocked` is
additive).  Use this recommended stack:

```
[object]  Objectives   — victory/defeat markers
[object]  Spawns       — unit spawn points
[object]  Hazards      — damage zones
[tile]    Walls        — impassable tiles (blocked=true in tileset)
[tile]    Terrain      — difficult terrain and cover objects
[tile]    Ground       — base floor
```

Only layers with `visible: true` are processed by the engine.  You can use invisible
layers for notes or designer references without affecting gameplay.

---

## Tile Custom Properties

Custom properties are defined **on tile definitions inside the tileset**, not on
individual placed tiles.  In Tiled: select the tileset, open the Tile Properties panel,
select a tile, and add properties under the Custom Properties tab.

### `blocked` (bool, default `false`)

The tile is impassable.  Units cannot move through it and it blocks line of effect.

```json
{ "name": "blocked", "type": "bool", "value": true }
```

Use this on wall tiles, closed doors, and solid obstacles.

---

### `moveCost` (int, default `1`)

How many points of movement speed it costs to **enter** this tile.  Standard PF2e
difficult terrain costs 2 (halves effective speed).  Only values other than `1` are
stored in `MapState`; tiles with no property default to `1`.

```json
{ "name": "moveCost", "type": "int", "value": 2 }
```

Common values:
| Value | Terrain type |
|---|---|
| `1` | Normal floor, stone, packed dirt |
| `2` | Rubble, shallow water, mud, snow |
| `3` | Deep water, bog (rarely used) |

In the movement range overlay, tiles that cost `> 1` to enter are highlighted in
**amber** instead of blue, giving the player a clear visual warning.

---

### `coverGrade` (int, default `0`)

The amount of cover this tile provides to units adjacent to it.  Blocked tiles
always contribute `1` to cover score automatically.

```json
{ "name": "coverGrade", "type": "int", "value": 1 }
```

| Value | Cover type | AC bonus |
|---|---|---|
| `0` | No cover | +0 |
| `1` | Standard cover (low wall, crates, barrel) | +2 AC |
| `2` | Greater cover (arrow slit, murder hole) | +4 AC |

Cover is calculated per-attack based on tiles flanking the **target** in the direction
of the attacker.  A unit standing directly behind a `coverGrade=1` crate benefits from
standard cover (+2 AC) against attacks from across the crate.

---

### `elevation` (int, default `0`)

Height of this tile above the ground plane in tile units.  Currently stored in
`MapState` for future use (elevated attacks, fall damage).  Not yet used in combat
calculations.

```json
{ "name": "elevation", "type": "int", "value": 1 }
```

---

### `terrain` (string, optional)

A descriptive label for the terrain type.  Not used in combat calculations but may be
referenced by future scripting and narrative events.

```json
{ "name": "terrain", "type": "string", "value": "water" }
```

---

## Tile Layer Conventions

### Ground layer

Place a single walkable floor tile across the entire map.  GID 0 (empty) cells are not
processed.

### Walls layer

Place wall/obstacle tiles where you want impassable terrain.  These tiles must have
`blocked=true` in their tileset definition.  The engine derives the `blocked` list from
all visible tile layers.

### Terrain layer

Place difficult terrain and cover tiles **on top of the ground layer**.  Only cells that
differ from the default (moveCost=1, coverGrade=0) need tiles here.  The rest of the
layer should be GID 0 (empty).

Using a separate layer for terrain keeps the ground layer clean and lets you toggle
terrain visibility during authoring.

---

## Object Layers

### Spawns layer

Layer name: `Spawns` (case-insensitive), type: `objectgroup`.

Each object of type `spawn` defines one unit.  Place objects at the **top-left pixel**
of the desired grid cell (e.g. column 3, row 2 → x=96, y=64 for 32 px tiles).

#### Required spawn properties

| Property | Type | Description |
|---|---|---|
| `team` | string | `"pc"` for player-controlled; any other string for AI-controlled. |
| `hp` | int | Maximum and starting hit points. |

#### Optional spawn properties (all have defaults)

| Property | Type | Default | Description |
|---|---|---|---|
| `initiative` | int | `0` | Initiative modifier for turn order. |
| `attackMod` | int | `0` | Attack roll modifier. |
| `ac` | int | `10` | Armour class. |
| `damage` | string | `"1d4"` | Damage dice expression (e.g. `"2d6+4"`). |
| `attackDamageType` | string | `"physical"` | Damage type (physical, fire, cold, …). |
| `fortitude` | int | `0` | Fortitude save modifier. |
| `reflex` | int | `0` | Reflex save modifier. |
| `will` | int | `0` | Will save modifier. |
| `tempHp` | int | `0` | Temporary hit points at battle start. |
| `speed` | int | `5` | Movement speed in tiles. |

The object's `name` field becomes the unit's `unitId`.  It must be unique across all
spawns in the map.

Enemy teams (any team that is not `"pc"`) automatically receive an AI policy of
`strike_nearest` with `auto_end_turn: true`.  This can be overridden by adding a
hand-written `enemy_policy` block to the scenario JSON after export, or by creating a
custom scenario wrapper that calls `buildScenarioFromTiledMap`.

---

### Hazards layer

Layer name: `Hazards` (case-insensitive), type: `objectgroup`.

Each rectangle object of type `hazard` defines a damage zone.  The rectangle's pixel
area is converted to the grid cells it covers.

| Property | Type | Default | Description |
|---|---|---|---|
| `element` | string | `"fire"` | Damage element (fire, acid, cold, …). |
| `damagePerTurn` | int | `0` | HP lost per turn for units inside the zone. |
| `dc` | int | `0` | Save DC to avoid/halve the damage. |
| `saveType` | string | `"Reflex"` | Save type: `Fortitude`, `Reflex`, or `Will`. |

---

### Objectives layer

Layer name: `Objectives` (case-insensitive), type: `objectgroup`.

Point objects define victory and defeat conditions.  The object `name` becomes the
objective `id`, and the object `type` selects the condition kind.

| Object type | Wins when… |
|---|---|
| `defeat_all_enemies` | All enemy units are dead |
| `defend_position` | No enemy unit has reached the marked tile |
| `escort_unit` | The named unit reaches the marked tile |

| Property | Type | Description |
|---|---|---|
| `unitId` | string | For `escort_unit`: the unit that must reach the tile. |
| `label` | string | Display name shown in the victory/defeat overlay. |

---

## Worked Example

Below is the minimal tileset definition (inside the `.tmj` file) for a dungeon set with
four terrain tile types:

```json
"tiles": [
  {
    "id": 0,
    "properties": []
  },
  {
    "id": 1,
    "properties": [
      { "name": "moveCost",  "type": "int",  "value": 2 }
    ]
  },
  {
    "id": 4,
    "properties": [
      { "name": "coverGrade", "type": "int", "value": 1 }
    ]
  },
  {
    "id": 8,
    "properties": [
      { "name": "blocked", "type": "bool", "value": true }
    ]
  }
]
```

In this setup:
- **GID 1** (id 0) → plain floor, no properties needed
- **GID 2** (id 1) → rubble, costs 2 movement to enter
- **GID 5** (id 4) → low crate, provides standard cover (+2 AC) to adjacent units
- **GID 9** (id 8) → stone wall, impassable

Place GID 2 tiles in the **Terrain** layer where you want difficult terrain.  Place GID
5 tiles in the **Terrain** layer where you want cover objects.  The **Walls** layer uses
GID 9 for solid walls.

---

## Checklist

Before loading a map in-game, verify:

- [ ] Map property `battleId` is set and unique
- [ ] All wall/obstacle tiles have `blocked=true` in their tileset definition
- [ ] The `Spawns` layer exists and has at least one object of type `spawn`
- [ ] Every spawn object has a unique `name`, a `team`, and a positive `hp`
- [ ] Spawn pixel positions align to tile boundaries (multiples of tile size)
- [ ] No tile layer uses GID 0 for a meaningful game tile (0 = empty / skip)
- [ ] Difficult terrain tiles have `moveCost` > 1 in the tileset
- [ ] Cover tiles have `coverGrade` ≥ 1 in the tileset

---

## File Location

Save `.tmj` files in `public/maps/` and reference them in scenario JSON or via the in-app
file browser.  Tileset images referenced by the map should be in `public/tilesets/` using
a relative path like `../tilesets/my_tileset.png`.
