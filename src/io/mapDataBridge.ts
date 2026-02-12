/**
 * Map data bridge — converts a parsed ResolvedTiledMap into the structures
 * the engine already consumes (MapState, scenario JSON shape).
 *
 * This is the semantic translation layer.  It understands the authoring
 * conventions (layer names, object types, property names) and maps them to
 * engine types.  The engine itself never sees TiledMap.
 *
 * Only `blocked` tile data feeds MapState for now.  The `moveCost`, `terrain`,
 * `elevation`, and `cover` properties are reserved for future engine phases.
 */

import type { ResolvedTiledMap, TiledLayer } from "./tiledTypes";
import type { MapState } from "../engine/state";
import { resolveTileGid, getTileProperties, getProperties } from "./tiledLoader";

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

export interface SpawnPointData {
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

export interface HazardZoneData {
  id: string;
  element: string;
  damagePerTurn: number;
  dc: number;
  saveType: string;
  /** Grid cells covered by the rectangular hazard zone. */
  tiles: [number, number][];
}

export interface ObjectiveData {
  id: string;
  type: string;
  unitId?: string;
  label?: string;
  position?: [number, number];
}

export interface MapProperties {
  battleId: string;
  seed: number;
  enginePhase: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Finds a layer by name (case-insensitive) and optionally by type. */
function findLayer(
  layers: TiledLayer[],
  name: string,
  type?: TiledLayer["type"],
): TiledLayer | undefined {
  const lower = name.toLowerCase();
  return layers.find(
    (l) => l.name.toLowerCase() === lower && (type === undefined || l.type === type),
  );
}

/** Converts pixel coords to tile grid coords, clamping to non-negative integers. */
function pixelToTile(pixelValue: number, tileSize: number): number {
  return Math.floor(pixelValue / tileSize);
}

/**
 * Enumerates all grid cells covered by an object rectangle.
 * Uses the object's x/y (top-left), width, and height in pixels.
 */
function rectToTiles(
  x: number,
  y: number,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  const x0 = pixelToTile(x, tileWidth);
  const y0 = pixelToTile(y, tileHeight);
  const x1 = Math.ceil((x + width) / tileWidth);
  const y1 = Math.ceil((y + height) / tileHeight);
  for (let tx = x0; tx < x1; tx++) {
    for (let ty = y0; ty < y1; ty++) {
      tiles.push([tx, ty]);
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// extractMapProperties
// ---------------------------------------------------------------------------

/**
 * Reads map-level custom properties.
 * Throws if the required `battleId` property is missing.
 */
export function extractMapProperties(tiledMap: ResolvedTiledMap): MapProperties {
  const props = getProperties(tiledMap.properties);

  const battleId = props["battleId"];
  if (typeof battleId !== "string" || !battleId) {
    throw new Error(
      'mapDataBridge: Tiled map is missing required map property "battleId". ' +
        "Set it in Map > Map Properties in the Tiled editor.",
    );
  }

  return {
    battleId,
    seed: typeof props["seed"] === "number" ? Math.round(props["seed"] as number) : 0,
    enginePhase:
      typeof props["enginePhase"] === "number" ? Math.round(props["enginePhase"] as number) : 7,
  };
}

// ---------------------------------------------------------------------------
// extractMapState
// ---------------------------------------------------------------------------

/**
 * Scans all visible tile layers.  For each non-zero GID, looks up the tile's
 * custom properties and adds the coordinate to the blocked set if
 * `blocked === true`.
 *
 * Returns a MapState compatible with the existing engine pipeline.
 */
export function extractMapState(tiledMap: ResolvedTiledMap): MapState {
  const blockedSet = new Set<string>();

  for (const layer of tiledMap.layers) {
    if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;

    for (let i = 0; i < layer.data.length; i++) {
      const rawGid = layer.data[i];
      const resolved = resolveTileGid(rawGid, tiledMap.tilesets);
      if (!resolved) continue;

      const tileProps = getTileProperties(resolved.tileset, resolved.localId);
      if (tileProps["blocked"] === true) {
        const x = i % tiledMap.width;
        const y = Math.floor(i / tiledMap.width);
        blockedSet.add(`${x},${y}`);
      }
    }
  }

  const blocked: [number, number][] = [...blockedSet].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return [x, y];
  });

  return {
    width: tiledMap.width,
    height: tiledMap.height,
    blocked,
  };
}

// ---------------------------------------------------------------------------
// extractSpawnPoints
// ---------------------------------------------------------------------------

/**
 * Reads the "Spawns" object layer.  Each object of type "spawn" becomes a
 * unit definition.  Required properties: team, hp, initiative, attackMod, ac,
 * damage.  All others default to safe values.
 */
export function extractSpawnPoints(tiledMap: ResolvedTiledMap): SpawnPointData[] {
  const layer = findLayer(tiledMap.layers, "Spawns", "objectgroup");
  if (!layer || !layer.objects) return [];

  const spawns: SpawnPointData[] = [];

  for (const obj of layer.objects) {
    if (obj.type !== "spawn") continue;

    const props = getProperties(obj.properties);

    const team = props["team"];
    if (typeof team !== "string" || !team) {
      throw new Error(
        `mapDataBridge: spawn object "${obj.name}" is missing required property "team".`,
      );
    }

    const hp = Number(props["hp"]);
    if (!Number.isInteger(hp) || hp <= 0) {
      throw new Error(
        `mapDataBridge: spawn object "${obj.name}" has invalid or missing property "hp" (must be positive int).`,
      );
    }

    const initiative = Number(props["initiative"] ?? 0);
    const attackMod = Number(props["attackMod"] ?? 0);
    const ac = Number(props["ac"] ?? 10);
    const damage = String(props["damage"] ?? "1d4");
    const attackDamageType = String(props["attackDamageType"] ?? "physical");
    const fortitude = Number(props["fortitude"] ?? 0);
    const reflex = Number(props["reflex"] ?? 0);
    const will = Number(props["will"] ?? 0);
    const tempHp = Number(props["tempHp"] ?? 0);

    // Object position is top-left pixel; divide by tile size for grid coords.
    const gridX = pixelToTile(obj.x, tiledMap.tilewidth);
    const gridY = pixelToTile(obj.y, tiledMap.tileheight);

    spawns.push({
      id: obj.name,
      team,
      position: [gridX, gridY],
      hp,
      initiative,
      attackMod,
      ac,
      damage,
      attackDamageType,
      fortitude,
      reflex,
      will,
      tempHp,
    });
  }

  return spawns;
}

// ---------------------------------------------------------------------------
// extractHazardZones
// ---------------------------------------------------------------------------

/**
 * Reads the "Hazards" object layer.  Each object of type "hazard" becomes a
 * hazard zone with a list of covered grid cells.
 */
export function extractHazardZones(tiledMap: ResolvedTiledMap): HazardZoneData[] {
  const layer = findLayer(tiledMap.layers, "Hazards", "objectgroup");
  if (!layer || !layer.objects) return [];

  const zones: HazardZoneData[] = [];

  for (const obj of layer.objects) {
    if (obj.type !== "hazard") continue;

    const props = getProperties(obj.properties);

    zones.push({
      id: obj.name,
      element: String(props["element"] ?? "fire"),
      damagePerTurn: Number(props["damagePerTurn"] ?? 0),
      dc: Number(props["dc"] ?? 0),
      saveType: String(props["saveType"] ?? "Reflex"),
      tiles: rectToTiles(obj.x, obj.y, obj.width, obj.height, tiledMap.tilewidth, tiledMap.tileheight),
    });
  }

  return zones;
}

// ---------------------------------------------------------------------------
// extractObjectives
// ---------------------------------------------------------------------------

/**
 * Reads the "Objectives" object layer.
 */
export function extractObjectives(tiledMap: ResolvedTiledMap): ObjectiveData[] {
  const layer = findLayer(tiledMap.layers, "Objectives", "objectgroup");
  if (!layer || !layer.objects) return [];

  const objectives: ObjectiveData[] = [];

  for (const obj of layer.objects) {
    const props = getProperties(obj.properties);
    const gridX = pixelToTile(obj.x, tiledMap.tilewidth);
    const gridY = pixelToTile(obj.y, tiledMap.tileheight);

    objectives.push({
      id: obj.name,
      type: obj.type,
      unitId: typeof props["unitId"] === "string" ? (props["unitId"] as string) : undefined,
      label: typeof props["label"] === "string" ? (props["label"] as string) : undefined,
      position: [gridX, gridY],
    });
  }

  return objectives;
}

// ---------------------------------------------------------------------------
// buildScenarioFromTiledMap
// ---------------------------------------------------------------------------

/**
 * Top-level convenience: converts a fully-resolved TiledMap into a plain
 * object shaped exactly like a hand-written scenario JSON file.
 *
 * The result can be fed directly into `validateScenario()` +
 * `battleStateFromScenario()` with zero engine changes.
 *
 * Tiled maps are interactive arenas, so `commands` is an empty array.
 * Objectives extracted from the Objectives layer become scenario objectives.
 */
export function buildScenarioFromTiledMap(tiledMap: ResolvedTiledMap): Record<string, unknown> {
  const mapProps = extractMapProperties(tiledMap);
  const mapState = extractMapState(tiledMap);
  const spawns = extractSpawnPoints(tiledMap);
  const objectives = extractObjectives(tiledMap);

  if (spawns.length === 0) {
    throw new Error(
      "mapDataBridge: Tiled map has no spawn points.  Add a \"Spawns\" object layer " +
        "with at least one object of type \"spawn\".",
    );
  }

  // Convert SpawnPointData to the snake_case unit format the scenario schema expects
  const units = spawns.map((s) => ({
    id: s.id,
    team: s.team,
    hp: s.hp,
    position: s.position,
    initiative: s.initiative,
    attack_mod: s.attackMod,
    ac: s.ac,
    damage: s.damage,
    attack_damage_type: s.attackDamageType,
    fortitude: s.fortitude,
    reflex: s.reflex,
    will: s.will,
    temp_hp: s.tempHp > 0 ? s.tempHp : undefined,
  }));

  // Convert ObjectiveData to scenario objective format
  const scenarioObjectives = objectives.map((o) => ({
    id: o.id,
    type: o.type,
    ...(o.unitId !== undefined && { unit_id: o.unitId }),
    ...(o.label !== undefined && { label: o.label }),
    ...(o.position !== undefined && { tile_x: o.position[0], tile_y: o.position[1] }),
  }));

  // Auto-generate enemy_policy for any non-PC team found in the spawn points.
  // Without this, buildOrchestratorConfig defaults to enabled:false and the
  // game soft-locks when the player passes the turn to an enemy unit.
  const playerTeam = "pc";
  const enemyTeams = [...new Set(spawns.map((s) => s.team).filter((t) => t !== playerTeam))];
  const enemyPolicy = enemyTeams.length > 0
    ? { enabled: true, teams: enemyTeams, action: "strike_nearest", auto_end_turn: true }
    : undefined;

  return {
    battle_id: mapProps.battleId,
    seed: mapProps.seed,
    engine_phase: mapProps.enginePhase,
    map: {
      width: mapState.width,
      height: mapState.height,
      blocked: mapState.blocked,
    },
    units,
    commands: [],
    objectives: scenarioObjectives,
    flags: {},
    mission_events: [],
    reinforcement_waves: [],
    hazard_routines: [],
    ...(enemyPolicy !== undefined && { enemy_policy: enemyPolicy }),
  };
}
