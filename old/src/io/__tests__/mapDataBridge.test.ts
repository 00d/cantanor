/**
 * Unit tests for mapDataBridge.ts
 * Uses inline TiledMap fixtures — no filesystem or HTTP required.
 */

import { describe, it, expect } from "vitest";
import {
  extractMapState,
  extractSpawnPoints,
  extractHazardZones,
  extractObjectives,
  extractMapProperties,
  buildScenarioFromTiledMap,
} from "../mapDataBridge";
import { validateScenario, battleStateFromScenario } from "../scenarioLoader";
import type { ResolvedTiledMap, TiledTileset, TiledLayer } from "../tiledTypes";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeTileset(overrides: Partial<TiledTileset> = {}): TiledTileset {
  return {
    firstgid: 1,
    name: "test",
    image: "test.png",
    imagewidth: 64,
    imageheight: 32,
    tilewidth: 32,
    tileheight: 32,
    tilecount: 2,
    columns: 2,
    margin: 0,
    spacing: 0,
    // localId 0 = floor (not blocked), localId 1 = wall (blocked)
    tiles: [
      { id: 0, properties: [{ name: "blocked", type: "bool", value: false }] },
      { id: 1, properties: [{ name: "blocked", type: "bool", value: true }] },
    ],
    ...overrides,
  };
}

function makeGroundLayer(data: number[], width = 3, height = 3): TiledLayer {
  return {
    id: 1, name: "Ground", type: "tilelayer",
    visible: true, opacity: 1, x: 0, y: 0, width, height, data,
  };
}

function makeMap(overrides: Partial<ResolvedTiledMap> = {}): ResolvedTiledMap {
  const tileset = makeTileset();
  return {
    version: "1.10",
    tiledversion: "1.10.0",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: 3,
    height: 3,
    tilewidth: 32,
    tileheight: 32,
    infinite: false,
    layers: [makeGroundLayer([1, 1, 1, 1, 2, 1, 1, 1, 1])], // center tile (1,1) is blocked
    tilesets: [tileset],
    properties: [
      { name: "battleId", type: "string", value: "test_arena" },
      { name: "seed", type: "int", value: 42 },
      { name: "enginePhase", type: "int", value: 7 },
    ],
    ...overrides,
  };
}

/** Minimal valid spawn object */
function makeSpawnLayer(spawns: Array<{
  name: string; x: number; y: number;
  team?: string; hp?: number; damage?: string;
}>): TiledLayer {
  return {
    id: 10, name: "Spawns", type: "objectgroup",
    visible: true, opacity: 1, x: 0, y: 0,
    objects: spawns.map((s, i) => ({
      id: 100 + i,
      name: s.name,
      type: "spawn",
      x: s.x, y: s.y, width: 32, height: 32,
      rotation: 0, visible: true,
      properties: [
        { name: "team", type: "string", value: s.team ?? "pc" },
        { name: "hp", type: "int", value: s.hp ?? 10 },
        { name: "initiative", type: "int", value: 12 },
        { name: "attackMod", type: "int", value: 4 },
        { name: "ac", type: "int", value: 14 },
        { name: "damage", type: "string", value: s.damage ?? "1d6+2" },
      ],
    })),
  };
}

// ---------------------------------------------------------------------------
// extractMapProperties
// ---------------------------------------------------------------------------

describe("extractMapProperties", () => {
  it("reads battleId, seed, and enginePhase", () => {
    const props = extractMapProperties(makeMap());
    expect(props.battleId).toBe("test_arena");
    expect(props.seed).toBe(42);
    expect(props.enginePhase).toBe(7);
  });

  it("defaults seed to 0 when absent", () => {
    const map = makeMap({ properties: [{ name: "battleId", type: "string", value: "x" }] });
    expect(extractMapProperties(map).seed).toBe(0);
  });

  it("defaults enginePhase to 7 when absent", () => {
    const map = makeMap({ properties: [{ name: "battleId", type: "string", value: "x" }] });
    expect(extractMapProperties(map).enginePhase).toBe(7);
  });

  it("throws when battleId is missing", () => {
    const map = makeMap({ properties: [] });
    expect(() => extractMapProperties(map)).toThrow(/battleId/);
  });

  it("throws when battleId is an empty string", () => {
    const map = makeMap({ properties: [{ name: "battleId", type: "string", value: "" }] });
    expect(() => extractMapProperties(map)).toThrow(/battleId/);
  });
});

// ---------------------------------------------------------------------------
// extractMapState
// ---------------------------------------------------------------------------

describe("extractMapState", () => {
  it("returns correct width and height", () => {
    const state = extractMapState(makeMap());
    expect(state.width).toBe(3);
    expect(state.height).toBe(3);
  });

  it("marks the center tile blocked (GID 2 = localId 1 = blocked:true)", () => {
    const state = extractMapState(makeMap());
    // Center tile (1,1) has GID 2, localId 1, blocked=true
    expect(state.blocked).toContainEqual([1, 1]);
  });

  it("does not mark floor tiles as blocked", () => {
    const state = extractMapState(makeMap());
    expect(state.blocked).not.toContainEqual([0, 0]);
    expect(state.blocked).not.toContainEqual([2, 2]);
  });

  it("skips GID 0 (empty cell)", () => {
    const data = [0, 0, 0, 0, 1, 0, 0, 0, 0]; // all empty or floor
    const map = makeMap({ layers: [makeGroundLayer(data)] });
    expect(extractMapState(map).blocked).toHaveLength(0);
  });

  it("returns empty blocked array when no tiles are blocked", () => {
    const data = [1, 1, 1, 1, 1, 1, 1, 1, 1]; // all floor (localId 0, not blocked)
    const map = makeMap({ layers: [makeGroundLayer(data)] });
    expect(extractMapState(map).blocked).toHaveLength(0);
  });

  it("aggregates blocked tiles from multiple tile layers", () => {
    const groundData = [1, 1, 1, 1, 1, 1, 1, 1, 1]; // all floor
    const wallData  = [1, 2, 1, 1, 1, 1, 1, 1, 2]; // (1,0) and (2,2) blocked
    const wallLayer: TiledLayer = {
      id: 2, name: "Walls", type: "tilelayer",
      visible: true, opacity: 1, x: 0, y: 0, width: 3, height: 3,
      data: wallData,
    };
    const map = makeMap({
      layers: [makeGroundLayer(groundData), wallLayer],
    });
    const state = extractMapState(map);
    expect(state.blocked).toContainEqual([1, 0]);
    expect(state.blocked).toContainEqual([2, 2]);
  });

  it("skips invisible tile layers", () => {
    const data = [1, 2, 1, 1, 1, 1, 1, 1, 1]; // (1,0) would be blocked
    const invisibleLayer: TiledLayer = {
      ...makeGroundLayer(data),
      visible: false,
    };
    const map = makeMap({ layers: [invisibleLayer] });
    expect(extractMapState(map).blocked).toHaveLength(0);
  });

  it("deduplicates when multiple layers mark the same tile blocked", () => {
    const data = [2, 1, 1, 1, 1, 1, 1, 1, 1]; // (0,0) blocked in both layers
    const layer1 = makeGroundLayer(data);
    const layer2: TiledLayer = { ...makeGroundLayer(data), id: 2, name: "Walls" };
    const map = makeMap({ layers: [layer1, layer2] });
    const state = extractMapState(map);
    const count = state.blocked.filter(([x, y]) => x === 0 && y === 0).length;
    expect(count).toBe(1);
  });

  it("correctly computes grid coords from flat index (row-major)", () => {
    // 3-wide map: index 5 → x = 5 % 3 = 2, y = floor(5/3) = 1
    const data = [1, 1, 1, 1, 1, 2, 1, 1, 1]; // only index 5 is blocked
    const map = makeMap({ layers: [makeGroundLayer(data)] });
    const state = extractMapState(map);
    expect(state.blocked).toContainEqual([2, 1]);
    expect(state.blocked).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractSpawnPoints
// ---------------------------------------------------------------------------

describe("extractSpawnPoints", () => {
  it("returns empty array when no Spawns layer exists", () => {
    const map = makeMap(); // no Spawns layer
    expect(extractSpawnPoints(map)).toEqual([]);
  });

  it("reads basic spawn properties", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        makeSpawnLayer([{ name: "pc_warrior", x: 32, y: 64 }]),
      ],
    });
    const spawns = extractSpawnPoints(map);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].id).toBe("pc_warrior");
    expect(spawns[0].team).toBe("pc");
    expect(spawns[0].hp).toBe(10);
  });

  it("converts pixel coords to tile grid coords (32px tiles)", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        makeSpawnLayer([
          { name: "u1", x: 0, y: 0 },   // grid (0,0)
          { name: "u2", x: 32, y: 0 },  // grid (1,0)
          { name: "u3", x: 0, y: 64 },  // grid (0,2)
          { name: "u4", x: 64, y: 64 }, // grid (2,2)
        ]),
      ],
    });
    const spawns = extractSpawnPoints(map);
    expect(spawns[0].position).toEqual([0, 0]);
    expect(spawns[1].position).toEqual([1, 0]);
    expect(spawns[2].position).toEqual([0, 2]);
    expect(spawns[3].position).toEqual([2, 2]);
  });

  it("converts pixel coords correctly for 64px tiles", () => {
    const map = makeMap({
      tilewidth: 64, tileheight: 64,
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        makeSpawnLayer([{ name: "hero", x: 128, y: 64 }]),
      ],
    });
    const spawns = extractSpawnPoints(map);
    expect(spawns[0].position).toEqual([2, 1]); // 128/64=2, 64/64=1
  });

  it("uses safe defaults for optional properties", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 10, name: "Spawns", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 101, name: "enemy_basic", type: "spawn",
            x: 32, y: 32, width: 32, height: 32, rotation: 0, visible: true,
            properties: [
              { name: "team", type: "string", value: "enemy" },
              { name: "hp", type: "int", value: 8 },
              // initiative, attackMod, ac, damage all absent → defaults
            ],
          }],
        },
      ],
    });
    const spawns = extractSpawnPoints(map);
    expect(spawns[0].initiative).toBe(0);
    expect(spawns[0].attackMod).toBe(0);
    expect(spawns[0].ac).toBe(10);
    expect(spawns[0].damage).toBe("1d4");
    expect(spawns[0].attackDamageType).toBe("physical");
    expect(spawns[0].fortitude).toBe(0);
    expect(spawns[0].reflex).toBe(0);
    expect(spawns[0].will).toBe(0);
    expect(spawns[0].tempHp).toBe(0);
  });

  it("throws when team is missing", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 10, name: "Spawns", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 101, name: "bad_unit", type: "spawn",
            x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true,
            properties: [{ name: "hp", type: "int", value: 5 }], // no team
          }],
        },
      ],
    });
    expect(() => extractSpawnPoints(map)).toThrow(/team/);
  });

  it("throws when hp is missing or invalid", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 10, name: "Spawns", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 101, name: "bad_hp", type: "spawn",
            x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true,
            properties: [{ name: "team", type: "string", value: "pc" }], // no hp
          }],
        },
      ],
    });
    expect(() => extractSpawnPoints(map)).toThrow(/hp/);
  });

  it("ignores objects that are not of type 'spawn'", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 10, name: "Spawns", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 101, name: "some_marker", type: "marker",
            x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true,
          }],
        },
      ],
    });
    expect(extractSpawnPoints(map)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractHazardZones
// ---------------------------------------------------------------------------

describe("extractHazardZones", () => {
  it("returns empty array when no Hazards layer exists", () => {
    expect(extractHazardZones(makeMap())).toEqual([]);
  });

  it("reads a single hazard zone with correct tile coverage", () => {
    // 32px tiles; a 64×32 rect at (32,64) covers tiles (1,2), (2,2)
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 20, name: "Hazards", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 200, name: "lava_pool", type: "hazard",
            x: 32, y: 64, width: 64, height: 32, rotation: 0, visible: true,
            properties: [
              { name: "element", type: "string", value: "fire" },
              { name: "damagePerTurn", type: "int", value: 5 },
              { name: "dc", type: "int", value: 14 },
              { name: "saveType", type: "string", value: "Reflex" },
            ],
          }],
        },
      ],
    });
    const zones = extractHazardZones(map);
    expect(zones).toHaveLength(1);
    expect(zones[0].id).toBe("lava_pool");
    expect(zones[0].element).toBe("fire");
    expect(zones[0].damagePerTurn).toBe(5);
    expect(zones[0].dc).toBe(14);
    expect(zones[0].saveType).toBe("Reflex");
    // 32px tiles: x=32→col1, y=64→row2, width=64→cols 1-2, height=32→row 2
    expect(zones[0].tiles).toContainEqual([1, 2]);
    expect(zones[0].tiles).toContainEqual([2, 2]);
  });
});

// ---------------------------------------------------------------------------
// extractObjectives
// ---------------------------------------------------------------------------

describe("extractObjectives", () => {
  it("returns empty array when no Objectives layer exists", () => {
    expect(extractObjectives(makeMap())).toEqual([]);
  });

  it("reads an objective with unitId and label", () => {
    const map = makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        {
          id: 30, name: "Objectives", type: "objectgroup",
          visible: true, opacity: 1, x: 0, y: 0,
          objects: [{
            id: 300, name: "obj_reach", type: "reach_tile",
            x: 64, y: 32, width: 32, height: 32, rotation: 0, visible: true,
            properties: [
              { name: "unitId", type: "string", value: "pc_hero" },
              { name: "label", type: "string", value: "Reach the exit" },
            ],
          }],
        },
      ],
    });
    const objectives = extractObjectives(map);
    expect(objectives).toHaveLength(1);
    expect(objectives[0].id).toBe("obj_reach");
    expect(objectives[0].type).toBe("reach_tile");
    expect(objectives[0].unitId).toBe("pc_hero");
    expect(objectives[0].label).toBe("Reach the exit");
    expect(objectives[0].position).toEqual([2, 1]); // 64/32=2, 32/32=1
  });
});

// ---------------------------------------------------------------------------
// buildScenarioFromTiledMap — integration with validateScenario
// ---------------------------------------------------------------------------

describe("buildScenarioFromTiledMap", () => {
  function makeValidMap(): ResolvedTiledMap {
    return makeMap({
      layers: [
        makeGroundLayer([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        makeSpawnLayer([
          { name: "pc_warrior", x: 0, y: 0, team: "pc", hp: 20 },
          { name: "orc_guard", x: 64, y: 64, team: "enemy", hp: 15 },
        ]),
      ],
    });
  }

  it("produces a scenario that passes validateScenario", () => {
    const scenario = buildScenarioFromTiledMap(makeValidMap());
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  it("produces a scenario from which battleStateFromScenario succeeds", () => {
    const scenario = buildScenarioFromTiledMap(makeValidMap());
    const state = battleStateFromScenario(scenario);
    expect(state.battleId).toBe("test_arena");
    expect(state.battleMap.width).toBe(3);
    expect(state.battleMap.height).toBe(3);
    expect(Object.keys(state.units)).toHaveLength(2);
  });

  it("uses the battleId from map properties", () => {
    const scenario = buildScenarioFromTiledMap(makeValidMap());
    expect(scenario["battle_id"]).toBe("test_arena");
  });

  it("has an empty commands array", () => {
    const scenario = buildScenarioFromTiledMap(makeValidMap());
    expect(scenario["commands"]).toEqual([]);
  });

  it("passes blocked tiles through to the engine", () => {
    // GID 2 → localId 1 → blocked:true; place it at index 4 = (1,1) on a 3-wide map
    const mapWithWall = makeMap({
      layers: [
        // Center tile (1,1) is GID 2 (blocked); rest are GID 1 (floor)
        makeGroundLayer([1, 1, 1, 1, 2, 1, 1, 1, 1]),
        makeSpawnLayer([
          { name: "pc_warrior", x: 0, y: 0, team: "pc", hp: 20 },
          { name: "orc_guard", x: 64, y: 64, team: "enemy", hp: 15 },
        ]),
      ],
    });
    const scenario = buildScenarioFromTiledMap(mapWithWall);
    const state = battleStateFromScenario(scenario);
    const isBlocked = state.battleMap.blocked.some(([x, y]) => x === 1 && y === 1);
    expect(isBlocked).toBe(true);
  });

  it("throws when the map has no spawn points", () => {
    const map = makeMap(); // no Spawns layer
    expect(() => buildScenarioFromTiledMap(map)).toThrow(/spawn/i);
  });

  it("throws when battleId is missing", () => {
    const map = makeMap({ properties: [] });
    expect(() => buildScenarioFromTiledMap(map)).toThrow(/battleId/);
  });
});
