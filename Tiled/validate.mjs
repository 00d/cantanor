/**
 * Validates Tiled/temple_courtyard.tmj by running it through the project's
 * actual Tiled pipeline (mapDataBridge.ts). Proves the map would load in the
 * browser — mapDataBridge is the full parse path; tiledLoader.ts only adds
 * fetch + external-tileset resolution, neither of which applies to an
 * embedded-tileset map read from disk.
 *
 * Run: npx tsx Tiled/validate.mjs
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { buildScenarioFromTiledMap, extractHazardZones } from "../src/io/mapDataBridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, "temple_courtyard.tmj");

// ---------------------------------------------------------------------------
// Load & parse
// ---------------------------------------------------------------------------

const tiledMap = JSON.parse(readFileSync(MAP_PATH, "utf8"));

// buildScenarioFromTiledMap throws on: missing battleId, zero spawns, bad team/hp
const scenario = buildScenarioFromTiledMap(tiledMap);

// extractHazardZones is also called inside buildScenarioFromTiledMap (output
// lands under scenario.map.hazards with snake_case keys); we call it directly
// here as well to verify the raw extractor against the pixel→tile math.
const hazards = extractHazardZones(tiledMap);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let failures = 0;
const results = [];

function check(label, actual, expected) {
  const ok = actual === expected;
  results.push({ label, actual, expected, ok });
  if (!ok) failures++;
}

function checkFn(label, actual, predicate, display) {
  const ok = predicate(actual);
  results.push({ label, actual: display ?? actual, expected: "(predicate)", ok });
  if (!ok) failures++;
}

// --- Map identity ---
check("battle_id",           scenario.battle_id,    "temple_courtyard");
check("seed",                scenario.seed,         15322);
check("engine_phase",        scenario.engine_phase, 7);
check("map.width",           scenario.map.width,    16);
check("map.height",          scenario.map.height,   12);

// --- Units ---
check("units.length",        scenario.units.length, 6);

const byId = Object.fromEntries(scenario.units.map(u => [u.id, u]));
check("paladin.team",        byId.pc_paladin?.team,        "pc");
check("paladin.position[0]", byId.pc_paladin?.position[0], 5);   // floor(160/32)
check("paladin.position[1]", byId.pc_paladin?.position[1], 9);   // floor(288/32)
check("paladin.hp",          byId.pc_paladin?.hp,          52);
check("paladin.ac",          byId.pc_paladin?.ac,          19);
check("paladin.attack_mod",  byId.pc_paladin?.attack_mod,  8);   // camelCase → snake_case
check("paladin.damage",      byId.pc_paladin?.damage,      "1d8+4");

check("guardian.team",       byId.temple_guardian?.team,        "cult");
check("guardian.position",   byId.temple_guardian?.position[0], 12);  // floor(384/32) — adjacent to statue, not on it
check("guardian.hp",         byId.temple_guardian?.hp,          65);

// --- speed (wired through mapDataBridge — was silently dropped prior to the
// audit that produced this validator; see extractSpawnPoints + buildScenarioFromTiledMap) ---
check("paladin.speed",       byId.pc_paladin?.speed,      5);
check("ranger.speed",        byId.pc_ranger?.speed,       6);
check("guardian.speed",      byId.temple_guardian?.speed, 4);

// --- Blocked tiles ---
// Perimeter: row 0 (16) + row 11 (16 − 5-wide gap = 11) + rows 1–10 edges (10×2 = 20) = 47
// Plus the statue terrain tile at (11,4) = 48 total.
check("blocked.length",      scenario.map.blocked.length, 48);

const blocked = new Set(scenario.map.blocked.map(([x, y]) => `${x},${y}`));
check("wall corner (0,0)",   blocked.has("0,0"),   true);
check("wall corner (15,11)", blocked.has("15,11"), true);
check("entrance open (6,11)",blocked.has("6,11"),  false);
check("statue at (11,4)",    blocked.has("11,4"),  true);
check("interior (5,5)",      blocked.has("5,5"),   false);

// --- moveCost (difficult terrain) ---
// 2× rubble_light (cost 2) + 4× rubble_heavy (cost 3) = 6 entries
const mc = scenario.map.move_cost ?? {};
check("move_cost entries",   Object.keys(mc).length, 6);
check("rubble_light (3,1)",  mc["3,1"],  2);
check("rubble_heavy (10,7)", mc["10,7"], 3);
check("rubble_heavy (11,8)", mc["11,8"], 3);

// --- coverGrade ---
// 4× pillar + 2× broken_column + 1× statue (grade 1) + 1× altar (grade 2) = 8 entries
const cg = scenario.map.cover_grade ?? {};
check("cover_grade entries", Object.keys(cg).length, 8);
check("pillar (2,2)",        cg["2,2"],  1);
check("pillar (13,8)",       cg["13,8"], 1);
check("altar (8,3)",         cg["8,3"],  2);
check("statue (11,4)",       cg["11,4"], 1);   // blocked AND provides cover

// --- elevation ---
// 3× dais tiles (elevation 1)
const el = scenario.map.elevation ?? {};
check("elevation entries",   Object.keys(el).length, 3);
check("dais (7,2)",          el["7,2"], 1);
check("dais (7,3)",          el["7,3"], 1);

// --- Hazard zone ---
check("hazards.length",      hazards.length,             1);
check("hazard.element",      hazards[0]?.element,        "cold");
check("hazard.dc",           hazards[0]?.dc,             15);
check("hazard.saveType",     hazards[0]?.saveType,       "Fortitude");
check("hazard.damagePerTurn",hazards[0]?.damagePerTurn,  4);
// Rect (128,160,160,64) at 32px → tiles [4,9) × [5,7) = 5×2 = 10 tiles
check("hazard.tiles.length", hazards[0]?.tiles.length,   10);
checkFn("hazard covers (6,5)",
        hazards[0]?.tiles,
        tiles => tiles.some(([x, y]) => x === 6 && y === 5),
        hazards[0]?.tiles.length + " tiles");

// --- Hazard zone as surfaced through buildScenarioFromTiledMap → map.hazards
// (wired during the audit — was hard-coded empty prior; shape matches the
// validateScenario schema and the tiled_map hybrid path in scenarioLoader.ts) ---
const mh = scenario.map.hazards ?? [];
check("map.hazards.length",          mh.length,                1);
check("map.hazards[0].id",           mh[0]?.id,                "cursed_pool");
check("map.hazards[0].damage_type",  mh[0]?.damage_type,       "cold");        // element → damage_type
check("map.hazards[0].damage_per_turn", mh[0]?.damage_per_turn, 4);
check("map.hazards[0].dc",           mh[0]?.dc,                15);
check("map.hazards[0].save_type",    mh[0]?.save_type,         "Fortitude");
check("map.hazards[0].tiles.length", mh[0]?.tiles.length,      10);

// --- Objectives ---
check("objectives.length",   scenario.objectives.length,     1);
check("objective.type",      scenario.objectives[0]?.type,   "defeat_all_enemies");
check("objective.label",     scenario.objectives[0]?.label,  "Cleanse the Temple");

// --- Enemy policy (auto-generated for non-pc teams) ---
check("enemy_policy.enabled",scenario.enemy_policy?.enabled,       true);
check("enemy_policy.action", scenario.enemy_policy?.action,        "strike_nearest");
checkFn("enemy_policy.teams includes cult",
        scenario.enemy_policy?.teams,
        t => Array.isArray(t) && t.includes("cult"),
        JSON.stringify(scenario.enemy_policy?.teams));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const W = Math.max(...results.map(r => r.label.length));
console.log(`\ntemple_courtyard.tmj → mapDataBridge\n${"─".repeat(60)}`);
for (const r of results) {
  const mark = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  const line = `  ${mark} ${r.label.padEnd(W)}  ${String(r.actual)}`;
  console.log(r.ok ? line : `${line}  (expected ${r.expected})`);
}
console.log("─".repeat(60));
console.log(failures === 0
  ? `\x1b[32m${results.length} checks passed\x1b[0m`
  : `\x1b[31m${failures} of ${results.length} checks FAILED\x1b[0m`);

process.exit(failures === 0 ? 0 : 1);
