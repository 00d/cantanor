/**
 * Scenario loading and lightweight validation.
 * Mirrors engine/io/scenario_loader.py
 */

import { BattleState, MapState, UnitState } from "../engine/state";
import { buildTurnOrder } from "../engine/turnOrder";
import type { ResolvedTiledMap } from "./tiledTypes";
import { resolveScenarioContentContext, type ContentContext } from "./contentPackLoader";

export class ScenarioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioValidationError";
  }
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new ScenarioValidationError(message);
}

function validateUnitShape(unit: Record<string, unknown>, context: string): void {
  require(typeof unit === "object" && unit !== null, `${context} must be object`);
  for (const key of ["id", "team", "hp", "position", "initiative", "attack_mod", "ac", "damage"]) {
    require(key in unit, `${context} missing key: ${key}`);
  }
  require(
    typeof unit["id"] === "string" && Boolean(unit["id"]),
    `${context}.id must be non-empty string`,
  );
  require(
    typeof unit["team"] === "string" && Boolean(unit["team"]),
    `${context}.team must be non-empty string`,
  );
  require(
    typeof unit["hp"] === "number" && Number.isInteger(unit["hp"]) && Number(unit["hp"]) > 0,
    `${context}.hp must be positive int`,
  );
  const tempHp = unit["temp_hp"];
  if (tempHp !== undefined && tempHp !== null) {
    require(
      typeof tempHp === "number" && Number.isInteger(tempHp) && Number(tempHp) >= 0,
      `${context}.temp_hp must be non-negative int`,
    );
  }
  const pos = unit["position"];
  require(Array.isArray(pos) && (pos as unknown[]).length === 2, `${context}.position must be [x, y]`);
  require(
    Number.isInteger((pos as unknown[])[0]) && Number.isInteger((pos as unknown[])[1]),
    `${context}.position values must be ints`,
  );
  const attackDamageType = unit["attack_damage_type"];
  if (attackDamageType !== undefined && attackDamageType !== null) {
    require(
      typeof attackDamageType === "string" && Boolean(attackDamageType),
      `${context}.attack_damage_type must be non-empty string`,
    );
  }
  const attackDamageBypass = unit["attack_damage_bypass"];
  if (attackDamageBypass !== undefined && attackDamageBypass !== null) {
    require(Array.isArray(attackDamageBypass), `${context}.attack_damage_bypass must be list`);
    for (let idx = 0; idx < (attackDamageBypass as unknown[]).length; idx++) {
      const item = (attackDamageBypass as unknown[])[idx];
      require(
        typeof item === "string" && Boolean(item),
        `${context}.attack_damage_bypass[${idx}] must be non-empty string`,
      );
    }
  }
  for (const fieldName of ["resistances", "weaknesses"]) {
    const raw = unit[fieldName];
    if (raw === undefined || raw === null) continue;
    require(typeof raw === "object" && !Array.isArray(raw), `${context}.${fieldName} must be object`);
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      require(typeof k === "string" && Boolean(k), `${context}.${fieldName} keys must be non-empty strings`);
      require(
        typeof v === "number" && Number.isInteger(v) && Number(v) >= 0,
        `${context}.${fieldName}[${k}] must be non-negative int`,
      );
    }
  }
  const immunities = unit["immunities"];
  if (immunities !== undefined && immunities !== null) {
    require(Array.isArray(immunities), `${context}.immunities must be list`);
    for (let idx = 0; idx < (immunities as unknown[]).length; idx++) {
      const item = (immunities as unknown[])[idx];
      require(typeof item === "string" && Boolean(item), `${context}.immunities[${idx}] must be non-empty string`);
    }
  }
  const conditionImmunities = unit["condition_immunities"];
  if (conditionImmunities !== undefined && conditionImmunities !== null) {
    require(Array.isArray(conditionImmunities), `${context}.condition_immunities must be list`);
    for (let idx = 0; idx < (conditionImmunities as unknown[]).length; idx++) {
      const item = (conditionImmunities as unknown[])[idx];
      require(
        typeof item === "string" && Boolean(item),
        `${context}.condition_immunities[${idx}] must be non-empty string`,
      );
    }
  }
}

const VALID_COMMAND_TYPES = new Set([
  "move",
  "strike",
  "end_turn",
  "save_damage",
  "area_save_damage",
  "apply_effect",
  "trigger_hazard_source",
  "run_hazard_routine",
  "set_flag",
  "spawn_unit",
  "cast_spell",
  "use_feat",
  "use_item",
  "interact",
]);

function validateCommand(
  cmd: Record<string, unknown>,
  knownUnitIds: Set<string>,
  context: string,
  actorRequired = true,
): void {
  require(typeof cmd === "object" && cmd !== null, `${context} must be object`);
  require("type" in cmd, `${context} requires type`);
  const ctype = String(cmd["type"]);
  require(VALID_COMMAND_TYPES.has(ctype), `${context} unsupported command type: ${ctype}`);

  const actor = cmd["actor"];
  if (actorRequired) {
    require(typeof actor === "string", `${context} requires actor`);
    require(knownUnitIds.has(actor as string), `${context} actor not found: ${actor}`);
  } else if (actor !== undefined && actor !== null) {
    require(typeof actor === "string", `${context}.actor must be string when present`);
    require(knownUnitIds.has(actor as string), `${context} actor not found: ${actor}`);
  }

  if ("target" in cmd && cmd["target"] !== null && cmd["target"] !== undefined) {
    require(knownUnitIds.has(cmd["target"] as string), `${context} target not found: ${cmd["target"]}`);
  }
  if ("content_entry_id" in cmd) {
    require(
      typeof cmd["content_entry_id"] === "string" && Boolean(cmd["content_entry_id"]),
      `${context} content_entry_id must be non-empty string`,
    );
  }
  const hasContentEntry = Boolean(cmd["content_entry_id"]);

  if (ctype === "move") {
    require("x" in cmd && "y" in cmd, `${context} move requires x and y`);
  } else if (ctype === "strike") {
    require(typeof cmd["target"] === "string", `${context} strike requires target`);
  } else if (ctype === "save_damage") {
    for (const key of ["target", "dc", "save_type", "damage"]) {
      require(key in cmd, `${context} save_damage missing key: ${key}`);
    }
    require(
      ["Fortitude", "Reflex", "Will"].includes(String(cmd["save_type"])),
      `${context} save_damage save_type invalid`,
    );
    if ("damage_type" in cmd) {
      require(
        typeof cmd["damage_type"] === "string" && Boolean(cmd["damage_type"]),
        `${context} save_damage damage_type must be non-empty string`,
      );
    }
    if ("damage_bypass" in cmd) {
      require(Array.isArray(cmd["damage_bypass"]), `${context} save_damage damage_bypass must be list`);
      for (let idx = 0; idx < (cmd["damage_bypass"] as unknown[]).length; idx++) {
        const item = (cmd["damage_bypass"] as unknown[])[idx];
        require(typeof item === "string" && Boolean(item), `${context} save_damage damage_bypass[${idx}] must be non-empty string`);
      }
    }
    if ("mode" in cmd) {
      require(String(cmd["mode"]) === "basic", `${context} save_damage mode must be basic`);
    }
  } else if (ctype === "cast_spell") {
    for (const key of ["target", "dc"]) {
      require(key in cmd, `${context} cast_spell missing key: ${key}`);
    }
    if (!hasContentEntry) {
      for (const key of ["spell_id", "save_type", "damage"]) {
        require(key in cmd, `${context} cast_spell missing key: ${key}`);
      }
    }
    if ("spell_id" in cmd) {
      require(typeof cmd["spell_id"] === "string" && Boolean(cmd["spell_id"]), `${context} cast_spell spell_id must be non-empty string`);
    }
    if ("save_type" in cmd) {
      require(
        ["Fortitude", "Reflex", "Will"].includes(String(cmd["save_type"])),
        `${context} cast_spell save_type invalid`,
      );
    }
    if ("damage_type" in cmd) {
      require(typeof cmd["damage_type"] === "string" && Boolean(cmd["damage_type"]), `${context} cast_spell damage_type must be non-empty string`);
    }
    if ("damage_bypass" in cmd) {
      require(Array.isArray(cmd["damage_bypass"]), `${context} cast_spell damage_bypass must be list`);
      for (let idx = 0; idx < (cmd["damage_bypass"] as unknown[]).length; idx++) {
        const item = (cmd["damage_bypass"] as unknown[])[idx];
        require(typeof item === "string" && Boolean(item), `${context} cast_spell damage_bypass[${idx}] must be non-empty string`);
      }
    }
    if ("mode" in cmd) {
      require(String(cmd["mode"]) === "basic", `${context} cast_spell mode must be basic`);
    }
    if ("action_cost" in cmd) {
      require(
        typeof cmd["action_cost"] === "number" && Number.isInteger(cmd["action_cost"]) && Number(cmd["action_cost"]) > 0,
        `${context} cast_spell action_cost must be positive int`,
      );
    }
  } else if (ctype === "area_save_damage") {
    for (const key of ["center_x", "center_y", "radius_feet", "dc", "save_type", "damage"]) {
      require(key in cmd, `${context} area_save_damage missing key: ${key}`);
    }
    require(
      ["Fortitude", "Reflex", "Will"].includes(String(cmd["save_type"])),
      `${context} area_save_damage save_type invalid`,
    );
    if ("damage_type" in cmd) {
      require(typeof cmd["damage_type"] === "string" && Boolean(cmd["damage_type"]), `${context} area_save_damage damage_type must be non-empty string`);
    }
    if ("damage_bypass" in cmd) {
      require(Array.isArray(cmd["damage_bypass"]), `${context} area_save_damage damage_bypass must be list`);
      for (let idx = 0; idx < (cmd["damage_bypass"] as unknown[]).length; idx++) {
        const item = (cmd["damage_bypass"] as unknown[])[idx];
        require(typeof item === "string" && Boolean(item), `${context} area_save_damage damage_bypass[${idx}] must be non-empty string`);
      }
    }
    if ("mode" in cmd) {
      require(String(cmd["mode"]) === "basic", `${context} area_save_damage mode must be basic`);
    }
  } else if (ctype === "apply_effect") {
    for (const key of ["target", "effect_kind"]) {
      require(key in cmd, `${context} apply_effect missing key: ${key}`);
    }
  } else if (ctype === "use_feat") {
    require("target" in cmd, `${context} use_feat missing key: target`);
    if (!hasContentEntry) {
      for (const key of ["feat_id", "effect_kind"]) {
        require(key in cmd, `${context} use_feat missing key: ${key}`);
      }
    }
    if ("feat_id" in cmd) {
      require(typeof cmd["feat_id"] === "string" && Boolean(cmd["feat_id"]), `${context} use_feat feat_id must be non-empty string`);
    }
    if ("effect_kind" in cmd) {
      require(typeof cmd["effect_kind"] === "string" && Boolean(cmd["effect_kind"]), `${context} use_feat effect_kind must be non-empty string`);
    }
    if ("payload" in cmd) {
      require(typeof cmd["payload"] === "object" && !Array.isArray(cmd["payload"]), `${context} use_feat payload must be object`);
    }
    if ("duration_rounds" in cmd && cmd["duration_rounds"] !== null) {
      require(
        typeof cmd["duration_rounds"] === "number" && Number.isInteger(cmd["duration_rounds"]) && Number(cmd["duration_rounds"]) >= 0,
        `${context} use_feat duration_rounds must be non-negative int or null`,
      );
    }
    if ("tick_timing" in cmd && cmd["tick_timing"] !== null) {
      require(
        ["turn_start", "turn_end"].includes(String(cmd["tick_timing"])),
        `${context} use_feat tick_timing invalid`,
      );
    }
    if ("action_cost" in cmd) {
      require(
        typeof cmd["action_cost"] === "number" && Number.isInteger(cmd["action_cost"]) && Number(cmd["action_cost"]) > 0,
        `${context} use_feat action_cost must be positive int`,
      );
    }
  } else if (ctype === "use_item") {
    require("target" in cmd, `${context} use_item missing key: target`);
    if (!hasContentEntry) {
      for (const key of ["item_id", "effect_kind"]) {
        require(key in cmd, `${context} use_item missing key: ${key}`);
      }
    }
    if ("item_id" in cmd) {
      require(typeof cmd["item_id"] === "string" && Boolean(cmd["item_id"]), `${context} use_item item_id must be non-empty string`);
    }
    if ("effect_kind" in cmd) {
      require(typeof cmd["effect_kind"] === "string" && Boolean(cmd["effect_kind"]), `${context} use_item effect_kind must be non-empty string`);
    }
    if ("payload" in cmd) {
      require(typeof cmd["payload"] === "object" && !Array.isArray(cmd["payload"]), `${context} use_item payload must be object`);
    }
    if ("duration_rounds" in cmd && cmd["duration_rounds"] !== null) {
      require(
        typeof cmd["duration_rounds"] === "number" && Number.isInteger(cmd["duration_rounds"]) && Number(cmd["duration_rounds"]) >= 0,
        `${context} use_item duration_rounds must be non-negative int or null`,
      );
    }
    if ("tick_timing" in cmd && cmd["tick_timing"] !== null) {
      require(
        ["turn_start", "turn_end"].includes(String(cmd["tick_timing"])),
        `${context} use_item tick_timing invalid`,
      );
    }
    if ("action_cost" in cmd) {
      require(
        typeof cmd["action_cost"] === "number" && Number.isInteger(cmd["action_cost"]) && Number(cmd["action_cost"]) > 0,
        `${context} use_item action_cost must be positive int`,
      );
    }
  } else if (ctype === "interact") {
    if (!hasContentEntry) {
      require("interact_id" in cmd, `${context} interact missing key: interact_id`);
    }
    if ("interact_id" in cmd) {
      require(typeof cmd["interact_id"] === "string" && Boolean(cmd["interact_id"]), `${context} interact_id must be non-empty string`);
    }
    if ("effect_kind" in cmd && cmd["effect_kind"] !== null) {
      require(typeof cmd["effect_kind"] === "string" && Boolean(cmd["effect_kind"]), `${context} interact effect_kind must be non-empty string when present`);
    }
    if ("payload" in cmd) {
      require(typeof cmd["payload"] === "object" && !Array.isArray(cmd["payload"]), `${context} interact payload must be object`);
    }
    if ("duration_rounds" in cmd && cmd["duration_rounds"] !== null) {
      require(
        typeof cmd["duration_rounds"] === "number" && Number.isInteger(cmd["duration_rounds"]) && Number(cmd["duration_rounds"]) >= 0,
        `${context} interact duration_rounds must be non-negative int or null`,
      );
    }
    if ("tick_timing" in cmd && cmd["tick_timing"] !== null) {
      require(
        ["turn_start", "turn_end"].includes(String(cmd["tick_timing"])),
        `${context} interact tick_timing invalid`,
      );
    }
    if ("action_cost" in cmd) {
      require(
        typeof cmd["action_cost"] === "number" && Number.isInteger(cmd["action_cost"]) && Number(cmd["action_cost"]) > 0,
        `${context} interact action_cost must be positive int`,
      );
    }
    if ("flag" in cmd) {
      require(typeof cmd["flag"] === "string" && Boolean(cmd["flag"]), `${context} interact flag must be non-empty string`);
    }
    if ("value" in cmd) {
      require(typeof cmd["value"] === "boolean", `${context} interact value must be bool`);
    }
  } else if (ctype === "trigger_hazard_source") {
    for (const key of ["hazard_id", "source_name"]) {
      require(key in cmd, `${context} trigger_hazard_source missing key: ${key}`);
    }
  } else if (ctype === "run_hazard_routine") {
    for (const key of ["hazard_id", "source_name"]) {
      require(key in cmd, `${context} run_hazard_routine missing key: ${key}`);
    }
    if ("target_policy" in cmd) {
      require(
        ["as_configured", "explicit", "nearest_enemy", "nearest_enemy_area_center", "all_enemies"].includes(
          String(cmd["target_policy"]),
        ),
        `${context} run_hazard_routine target_policy invalid`,
      );
    }
  } else if (ctype === "set_flag") {
    require("flag" in cmd, `${context} set_flag missing key: flag`);
    if ("value" in cmd) {
      require(typeof cmd["value"] === "boolean", `${context} set_flag value must be bool`);
    }
  }

  if (ctype === "spawn_unit") {
    const unit = cmd["unit"];
    require(typeof unit === "object" && unit !== null && !Array.isArray(unit), `${context} spawn_unit requires unit object`);
    validateUnitShape(unit as Record<string, unknown>, `${context}.unit`);
    const unitId = String((unit as Record<string, unknown>)["id"]);
    require(!knownUnitIds.has(unitId), `${context} spawn unit id already exists: ${unitId}`);
    const placementPolicy = cmd["placement_policy"];
    if (placementPolicy !== undefined && placementPolicy !== null) {
      require(["exact", "nearest_open"].includes(String(placementPolicy)), `${context} spawn_unit placement_policy invalid`);
    }
    if ("spend_action" in cmd) {
      require(typeof cmd["spend_action"] === "boolean", `${context} spawn_unit spend_action must be bool`);
    }
    knownUnitIds.add(unitId);
  }
}

function validateCommandBlock(
  commands: unknown,
  knownUnitIds: Set<string>,
  context: string,
  actorRequired = true,
): Set<string> {
  require(Array.isArray(commands), `${context} must be list`);
  const localKnownIds = new Set(knownUnitIds);
  for (let cidx = 0; cidx < (commands as unknown[]).length; cidx++) {
    validateCommand(
      (commands as Record<string, unknown>[])[cidx],
      localKnownIds,
      `${context}[${cidx}]`,
      actorRequired,
    );
  }
  return localKnownIds;
}

export function validateScenario(data: Record<string, unknown>): void {
  const requiredTop = new Set(["battle_id", "seed", "map", "units", "commands"]);
  const missing = [...requiredTop].filter((k) => !(k in data));
  require(missing.length === 0, `missing required keys: ${missing}`);

  if ("engine_phase" in data) {
    require(
      typeof data["engine_phase"] === "number" && Number.isInteger(data["engine_phase"]) && Number(data["engine_phase"]) > 0,
      "engine_phase must be positive int when present",
    );
  }

  const mapData = data["map"] as Record<string, unknown>;
  require(typeof mapData === "object" && mapData !== null, "map must be an object");
  require(
    typeof mapData["width"] === "number" && Number.isInteger(mapData["width"]) && Number(mapData["width"]) > 0,
    "map.width must be positive int",
  );
  require(
    typeof mapData["height"] === "number" && Number.isInteger(mapData["height"]) && Number(mapData["height"]) > 0,
    "map.height must be positive int",
  );

  const contentPacks = (data["content_packs"] as unknown[]) ?? [];
  require(Array.isArray(contentPacks), "content_packs must be list when present");
  for (let idx = 0; idx < contentPacks.length; idx++) {
    require(typeof contentPacks[idx] === "string" && Boolean(contentPacks[idx]), `content_packs[${idx}] must be non-empty string`);
  }

  const contentPackId = data["content_pack_id"];
  if (contentPackId !== undefined && contentPackId !== null) {
    require(typeof contentPackId === "string" && Boolean(contentPackId), "content_pack_id must be non-empty string when present");
    require(contentPacks.length > 0, "content_pack_id requires non-empty content_packs list");
  }

  const requiredContentFeatures = (data["required_content_features"] as unknown[]) ?? [];
  require(Array.isArray(requiredContentFeatures), "required_content_features must be list when present");
  for (let idx = 0; idx < requiredContentFeatures.length; idx++) {
    require(
      typeof requiredContentFeatures[idx] === "string" && Boolean(requiredContentFeatures[idx]),
      `required_content_features[${idx}] must be non-empty string`,
    );
  }

  const units = data["units"] as unknown[];
  require(Array.isArray(units) && units.length > 0, "units must be a non-empty list");
  const unitIds = new Set<string>();
  for (const unit of units) {
    validateUnitShape(unit as Record<string, unknown>, "unit");
    const uid = String((unit as Record<string, unknown>)["id"]);
    require(!unitIds.has(uid), `duplicate unit id: ${uid}`);
    unitIds.add(uid);
  }

  const commands = data["commands"] as unknown[];
  require(Array.isArray(commands), "commands must be list");
  const knownIds = new Set(unitIds);
  for (const cmd of commands) {
    validateCommand(cmd as Record<string, unknown>, knownIds, "command");
  }

  const flags = (data["flags"] as Record<string, unknown>) ?? {};
  require(typeof flags === "object" && !Array.isArray(flags), "flags must be object when present");
  for (const [key, value] of Object.entries(flags)) {
    require(typeof key === "string", "flag keys must be strings");
    require(typeof value === "boolean", `flag ${key} must be bool`);
  }

  const objectives = (data["objectives"] as unknown[]) ?? [];
  require(Array.isArray(objectives), "objectives must be list when present");
  for (let idx = 0; idx < objectives.length; idx++) {
    const objective = objectives[idx] as Record<string, unknown>;
    require(typeof objective === "object" && objective !== null, `objective[${idx}] must be object`);
    require("id" in objective && "type" in objective, `objective[${idx}] requires id and type`);
    const otype = String(objective["type"]);
    if (["unit_reach_tile", "unit_dead", "unit_alive"].includes(otype)) {
      const unitId = objective["unit_id"];
      require(
        typeof unitId === "string" && knownIds.has(unitId),
        `objective[${idx}] unit_id invalid: ${unitId}`,
      );
    }
  }

  const objectivePacks = (data["objective_packs"] as unknown[]) ?? [];
  require(Array.isArray(objectivePacks), "objective_packs must be list when present");
  for (let idx = 0; idx < objectivePacks.length; idx++) {
    const pack = objectivePacks[idx] as Record<string, unknown>;
    require(typeof pack === "object" && pack !== null, `objective_pack[${idx}] must be object`);
    require("type" in pack, `objective_pack[${idx}] requires type`);
    const ptype = String(pack["type"] ?? "");
    if (ptype === "escape_unit") {
      const unitId = pack["unit_id"];
      require(
        typeof unitId === "string" && knownIds.has(unitId),
        `objective_pack[${idx}] unit_id invalid: ${unitId}`,
      );
    }
  }

  const enemyPolicy = data["enemy_policy"];
  if (enemyPolicy !== undefined && enemyPolicy !== null) {
    require(typeof enemyPolicy === "object" && !Array.isArray(enemyPolicy), "enemy_policy must be object when present");
    const ep = enemyPolicy as Record<string, unknown>;
    if ("enabled" in ep) {
      require(typeof ep["enabled"] === "boolean", "enemy_policy.enabled must be bool");
    }
    if ("teams" in ep) {
      const teams = ep["teams"];
      require(Array.isArray(teams), "enemy_policy.teams must be list");
      for (let idx = 0; idx < (teams as unknown[]).length; idx++) {
        const team = (teams as unknown[])[idx];
        require(typeof team === "string" && Boolean(team), `enemy_policy.teams[${idx}] must be non-empty string`);
      }
    }
    const action = String(ep["action"] ?? "strike_nearest");
    require(
      ["strike_nearest", "cast_spell_entry_nearest", "use_feat_entry_self", "use_item_entry_self", "interact_entry_self"].includes(action),
      "enemy_policy.action invalid",
    );
    if (["cast_spell_entry_nearest", "use_feat_entry_self", "use_item_entry_self", "interact_entry_self"].includes(action)) {
      require(
        typeof ep["content_entry_id"] === "string" && Boolean(ep["content_entry_id"]),
        `enemy_policy.content_entry_id required for action ${action}`,
      );
    }
    if (action === "cast_spell_entry_nearest") {
      require(
        typeof ep["dc"] === "number" && Number.isInteger(ep["dc"]) && Number(ep["dc"]) > 0,
        "enemy_policy.dc must be positive int for cast_spell_entry_nearest",
      );
    }
    if ("include_rationale" in ep) {
      require(typeof ep["include_rationale"] === "boolean", "enemy_policy.include_rationale must be bool");
    }
    if ("auto_end_turn" in ep) {
      require(typeof ep["auto_end_turn"] === "boolean", "enemy_policy.auto_end_turn must be bool");
    }
  }

  const missionEvents = (data["mission_events"] as unknown[]) ?? [];
  require(Array.isArray(missionEvents), "mission_events must be list when present");
  for (let idx = 0; idx < missionEvents.length; idx++) {
    const missionEvent = missionEvents[idx] as Record<string, unknown>;
    require(typeof missionEvent === "object" && missionEvent !== null, `mission_event[${idx}] must be object`);
    const trigger = missionEvent["trigger"];
    if (trigger !== undefined && trigger !== null) {
      require(
        ["turn_start", "round_start", "unit_dead", "unit_alive", "flag_set"].includes(String(trigger)),
        `mission_event[${idx}] trigger invalid: ${trigger}`,
      );
    }
    const triggerName = String(trigger ?? "turn_start");
    if (["unit_dead", "unit_alive"].includes(triggerName)) {
      const unitId = missionEvent["unit_id"];
      require(
        typeof unitId === "string" && knownIds.has(unitId),
        `mission_event[${idx}] unit_id invalid for ${triggerName}: ${unitId}`,
      );
    }
    if (triggerName === "flag_set") {
      const flagName = missionEvent["flag"];
      require(typeof flagName === "string" && Boolean(flagName), `mission_event[${idx}] flag is required for flag_set trigger`);
    }
    const activeUnit = missionEvent["active_unit"];
    if (activeUnit !== undefined && activeUnit !== null) {
      require(
        typeof activeUnit === "string" && knownIds.has(activeUnit),
        `mission_event[${idx}] active_unit invalid: ${activeUnit}`,
      );
    }
    const branchIds: Set<string>[] = [];

    const eventCommands = missionEvent["commands"];
    if (eventCommands !== undefined && eventCommands !== null) {
      branchIds.push(validateCommandBlock(eventCommands, knownIds, `mission_event[${idx}].commands`, false));
    }

    const thenCommands = missionEvent["then_commands"];
    const elseCommands = missionEvent["else_commands"];
    const hasBranch = thenCommands !== undefined || elseCommands !== undefined;
    if (hasBranch) {
      branchIds.push(validateCommandBlock(thenCommands ?? [], knownIds, `mission_event[${idx}].then_commands`, false));
      branchIds.push(validateCommandBlock(elseCommands ?? [], knownIds, `mission_event[${idx}].else_commands`, false));
    }

    require(branchIds.length > 0, `mission_event[${idx}] requires commands, then_commands, or else_commands`);
    const mergedIds = new Set(knownIds);
    for (const branchSet of branchIds) {
      for (const id of branchSet) mergedIds.add(id);
    }
    // Update knownIds for subsequent events
    for (const id of mergedIds) knownIds.add(id);
  }

  const reinforcementWaves = (data["reinforcement_waves"] as unknown[]) ?? [];
  require(Array.isArray(reinforcementWaves), "reinforcement_waves must be list when present");
  for (let idx = 0; idx < reinforcementWaves.length; idx++) {
    const wave = reinforcementWaves[idx] as Record<string, unknown>;
    require(typeof wave === "object" && wave !== null, `reinforcement_wave[${idx}] must be object`);
    const trigger = wave["trigger"];
    if (trigger !== undefined && trigger !== null) {
      require(["turn_start", "round_start"].includes(String(trigger)), `reinforcement_wave[${idx}] trigger invalid: ${trigger}`);
    }
    const placementPolicy = wave["placement_policy"];
    if (placementPolicy !== undefined && placementPolicy !== null) {
      require(["exact", "nearest_open"].includes(String(placementPolicy)), `reinforcement_wave[${idx}] placement_policy invalid: ${placementPolicy}`);
    }
    const activeUnit = wave["active_unit"];
    if (activeUnit !== undefined && activeUnit !== null) {
      require(
        typeof activeUnit === "string" && knownIds.has(activeUnit),
        `reinforcement_wave[${idx}] active_unit invalid: ${activeUnit}`,
      );
    }
    const waveUnits = wave["units"] as unknown[];
    require(Array.isArray(waveUnits) && waveUnits.length > 0, `reinforcement_wave[${idx}] units must be non-empty list`);
    for (let uidx = 0; uidx < waveUnits.length; uidx++) {
      validateUnitShape(waveUnits[uidx] as Record<string, unknown>, `reinforcement_wave[${idx}].units[${uidx}]`);
      const unitId = String((waveUnits[uidx] as Record<string, unknown>)["id"]);
      require(!knownIds.has(unitId), `reinforcement_wave[${idx}] duplicate spawned unit id: ${unitId}`);
      knownIds.add(unitId);
    }
  }

  const hazardRoutines = (data["hazard_routines"] as unknown[]) ?? [];
  require(Array.isArray(hazardRoutines), "hazard_routines must be list when present");
  for (let idx = 0; idx < hazardRoutines.length; idx++) {
    const routine = hazardRoutines[idx] as Record<string, unknown>;
    require(typeof routine === "object" && routine !== null, `hazard_routine[${idx}] must be object`);
    for (const key of ["unit_id", "hazard_id", "source_name"]) {
      require(key in routine, `hazard_routine[${idx}] missing key: ${key}`);
    }
    require(knownIds.has(String(routine["unit_id"])), `hazard_routine[${idx}] unit_id not found: ${routine["unit_id"]}`);
    const cadenceRounds = routine["cadence_rounds"];
    if (cadenceRounds !== undefined && cadenceRounds !== null) {
      require(
        typeof cadenceRounds === "number" && Number.isInteger(cadenceRounds) && Number(cadenceRounds) > 0,
        `hazard_routine[${idx}] cadence_rounds must be positive int`,
      );
    }
    const maxTriggers = routine["max_triggers"];
    if (maxTriggers !== undefined && maxTriggers !== null) {
      require(
        typeof maxTriggers === "number" && Number.isInteger(maxTriggers) && Number(maxTriggers) > 0,
        `hazard_routine[${idx}] max_triggers must be positive int`,
      );
    }
  }
}

export function battleStateFromScenario(data: Record<string, unknown>): BattleState {
  const mapData = data["map"] as Record<string, unknown>;
  const blocked: [number, number][] = ((mapData["blocked"] as unknown[]) ?? []).map(
    (cell) => [Number((cell as number[])[0]), Number((cell as number[])[1])] as [number, number],
  );
  const battleMap: MapState = {
    width: Number(mapData["width"]),
    height: Number(mapData["height"]),
    blocked,
  };

  const units: Record<string, UnitState> = {};
  for (const raw of (data["units"] as Record<string, unknown>[])) {
    const pos = raw["position"] as number[];
    const x = pos[0];
    const y = pos[1];
    const tempHp = Number(raw["temp_hp"] ?? 0);
    const unitId = String(raw["id"]);
    units[unitId] = {
      unitId,
      team: String(raw["team"]),
      hp: Number(raw["hp"]),
      maxHp: Number(raw["hp"]),
      x,
      y,
      initiative: Number(raw["initiative"]),
      attackMod: Number(raw["attack_mod"]),
      ac: Number(raw["ac"]),
      damage: String(raw["damage"]),
      tempHp,
      tempHpSource: tempHp > 0 ? "initial" : null,
      tempHpOwnerEffectId: null,
      attackDamageType: String(raw["attack_damage_type"] ?? "physical").toLowerCase(),
      attackDamageBypass: ((raw["attack_damage_bypass"] as string[]) ?? []).map((x) => String(x).toLowerCase()),
      fortitude: Number(raw["fortitude"] ?? 0),
      reflex: Number(raw["reflex"] ?? 0),
      will: Number(raw["will"] ?? 0),
      conditionImmunities: ((raw["condition_immunities"] as string[]) ?? []).map((x) =>
        String(x).toLowerCase().replace(/ /g, "_"),
      ),
      resistances: Object.fromEntries(
        Object.entries((raw["resistances"] as Record<string, number>) ?? {}).map(([k, v]) => [k.toLowerCase(), Number(v)]),
      ),
      weaknesses: Object.fromEntries(
        Object.entries((raw["weaknesses"] as Record<string, number>) ?? {}).map(([k, v]) => [k.toLowerCase(), Number(v)]),
      ),
      immunities: ((raw["immunities"] as string[]) ?? []).map((x) => String(x).toLowerCase()),
      conditions: {},
      actionsRemaining: 3,
      reactionAvailable: true,
      speed: Number(raw["speed"] ?? 5),
    };
  }

  const turnOrder = buildTurnOrder(units);
  require(turnOrder.length > 0, "no units available for turn order");

  return {
    battleId: String(data["battle_id"]),
    seed: Number(data["seed"]),
    roundNumber: 1,
    turnIndex: 0,
    turnOrder,
    units,
    battleMap,
    flags: Object.fromEntries(
      Object.entries((data["flags"] as Record<string, boolean>) ?? {}).map(([k, v]) => [String(k), Boolean(v)]),
    ),
    effects: {},
    eventSequence: 0,
  };
}

// ---------------------------------------------------------------------------
// Unified URL-based loader (auto-detects Tiled vs hand-written format)
// ---------------------------------------------------------------------------

export interface LoadScenarioResult {
  battle: BattleState;
  /** Present when the source was a Tiled .tmj file; null for JSON scenarios. */
  tiledMap: ResolvedTiledMap | null;
  enginePhase: number;
  /** Resolved content pack entries available to the action panel. */
  contentContext: ContentContext;
  /** Raw scenario JSON — used by the battle orchestrator to read enemy_policy, objectives, etc. */
  rawScenario: Record<string, unknown>;
}

/**
 * Fetches a scenario from `url` and returns a battle state plus optional
 * Tiled map reference.
 *
 * Format detection:
 *   - If the JSON contains a "tiledversion" field → Tiled .tmj format
 *   - Otherwise → hand-written scenario JSON (legacy path, unchanged)
 *
 * Both paths run through validateScenario() and battleStateFromScenario(),
 * so the engine receives identical data regardless of source format.
 */
export async function loadScenarioFromUrl(url: string): Promise<LoadScenarioResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load scenario: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as Record<string, unknown>;

  if ("tiledversion" in data) {
    // Tiled .tmj format — use dynamic imports so the Tiled modules are not
    // part of the module graph for tests that import scenarioLoader directly
    // (avoids changing module-load timing for the existing regression suite).
    const { loadTiledMap } = await import("./tiledLoader");
    const { buildScenarioFromTiledMap } = await import("./mapDataBridge");
    const tiledMap = await loadTiledMap(url);
    const scenarioData = buildScenarioFromTiledMap(tiledMap);
    validateScenario(scenarioData);
    const enginePhase = (scenarioData["engine_phase"] as number) ?? 7;
    const contentContext = await resolveScenarioContentContext(scenarioData, enginePhase);
    return {
      battle: battleStateFromScenario(scenarioData),
      tiledMap,
      enginePhase,
      contentContext,
      rawScenario: scenarioData,
    };
  }

  // Legacy hand-written JSON scenario
  validateScenario(data);
  const enginePhase = (data["engine_phase"] as number) ?? 7;
  const contentContext = await resolveScenarioContentContext(data, enginePhase);
  return {
    battle: battleStateFromScenario(data),
    tiledMap: null,
    enginePhase,
    contentContext,
    rawScenario: data,
  };
}
