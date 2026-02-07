/**
 * Deterministic scenario runner — orchestrates the full battle loop.
 * Mirrors engine/cli/run_scenario.py
 *
 * Handles mission events, hazard routines, enemy policy, objective checking,
 * and produces a final result with replay hash.
 */

import { evaluateObjectives, expandObjectivePacks } from "./objectives";
import { ReductionError, applyCommand } from "./reducer";
import { DeterministicRNG } from "./rng";
import { BattleState, activeUnitId, unitAlive } from "./state";
import { buildCommandAuthoringCatalog } from "../io/commandAuthoring";
import { ContentContext } from "../io/contentPackLoader";
import { replayHash } from "../io/eventLog";

export const DEFAULT_ENGINE_PHASE = 7;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function aliveTeams(state: BattleState): Set<string> {
  const teams = new Set<string>();
  for (const u of Object.values(state.units)) {
    if (unitAlive(u)) teams.add(u.team);
  }
  return teams;
}

function stateSnapshot(state: BattleState): Record<string, unknown> {
  const unitsSnap: Record<string, unknown> = {};
  for (const [uid, u] of Object.entries(state.units).sort(([a], [b]) => a.localeCompare(b))) {
    unitsSnap[uid] = {
      team: u.team,
      hp: u.hp,
      max_hp: u.maxHp,
      temp_hp: u.tempHp,
      temp_hp_source: u.tempHpSource,
      position: [u.x, u.y],
      alive: unitAlive(u),
      conditions: { ...u.conditions },
      attack_damage_type: u.attackDamageType,
      resistances: { ...u.resistances },
      weaknesses: { ...u.weaknesses },
      immunities: [...u.immunities],
    };
  }
  const sortedFlags: Record<string, boolean> = {};
  for (const k of Object.keys(state.flags).sort()) {
    sortedFlags[k] = state.flags[k];
  }
  return {
    battle_id: state.battleId,
    round: state.roundNumber,
    active_unit: activeUnitId(state),
    units: unitsSnap,
    flags: sortedFlags,
  };
}

function defaultCommandIdFromEntry(entryId: string): string {
  if (entryId.includes(".")) {
    return entryId.split(".", 2)[1];
  }
  return entryId;
}

function materializeContentEntryCommand(
  command: Record<string, unknown>,
  contentContext: ContentContext,
): Record<string, unknown> {
  const out = { ...command };
  const entryId = out["content_entry_id"];
  if (entryId === undefined || entryId === null) return out;
  const entryIdStr = String(entryId);
  const entry = contentContext.entryLookup[entryIdStr];
  if (!entry) {
    throw new ReductionError(`unknown content entry ${entryIdStr}`);
  }

  const payloadTemplate = { ...entry.payload };
  const templateType = payloadTemplate["command_type"];
  const commandType = String(out["type"] ?? "");
  if (templateType !== undefined && String(templateType) !== commandType) {
    throw new ReductionError(`content entry ${entryIdStr} command_type mismatch: ${templateType} != ${commandType}`);
  }

  if (!["cast_spell", "use_feat", "use_item", "interact"].includes(commandType)) {
    throw new ReductionError(`content_entry_id unsupported for command type: ${commandType}`);
  }

  delete payloadTemplate["command_type"];
  const merged: Record<string, unknown> = { ...payloadTemplate, ...out };

  if (commandType === "cast_spell" && !merged["spell_id"]) {
    merged["spell_id"] = defaultCommandIdFromEntry(entryIdStr);
  } else if (commandType === "use_feat" && !merged["feat_id"]) {
    merged["feat_id"] = defaultCommandIdFromEntry(entryIdStr);
  } else if (commandType === "use_item" && !merged["item_id"]) {
    merged["item_id"] = defaultCommandIdFromEntry(entryIdStr);
  } else if (commandType === "interact" && !merged["interact_id"]) {
    merged["interact_id"] = defaultCommandIdFromEntry(entryIdStr);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Hazard routines
// ---------------------------------------------------------------------------

interface NormalizedRoutine extends Record<string, unknown> {
  id: string;
  unit_id: string;
  hazard_id: string;
  source_name: string;
  source_type: string;
  target_policy: string;
  start_round: number;
  once: boolean;
  auto_end_turn: boolean;
  priority: number;
  cadence_rounds: number;
}

function normalizeHazardRoutines(scenario: Record<string, unknown>): Map<string, NormalizedRoutine[]> {
  const byUnit = new Map<string, NormalizedRoutine[]>();
  const rawRoutines = (scenario["hazard_routines"] as Record<string, unknown>[]) ?? [];
  for (let idx = 0; idx < rawRoutines.length; idx++) {
    const raw = rawRoutines[idx];
    const routine: NormalizedRoutine = {
      ...raw,
      id: String(raw["id"] ?? `routine_${idx + 1}`),
      unit_id: String(raw["unit_id"]),
      hazard_id: String(raw["hazard_id"]),
      source_name: String(raw["source_name"]),
      source_type: String(raw["source_type"] ?? "trigger_action"),
      target_policy: String(raw["target_policy"] ?? "nearest_enemy"),
      start_round: Number(raw["start_round"] ?? 1),
      once: Boolean(raw["once"] ?? false),
      auto_end_turn: Boolean(raw["auto_end_turn"] ?? true),
      priority: Number(raw["priority"] ?? 0),
      cadence_rounds: Number(raw["cadence_rounds"] ?? 1),
    };
    const unitId = routine.unit_id;
    if (!byUnit.has(unitId)) byUnit.set(unitId, []);
    byUnit.get(unitId)!.push(routine);
  }
  for (const [unitId, routines] of byUnit.entries()) {
    byUnit.set(
      unitId,
      routines.sort((a, b) => {
        const pa = a.priority - b.priority;
        if (pa !== 0) return pa;
        return a.id.localeCompare(b.id);
      }),
    );
  }
  return byUnit;
}

function routineEligible(
  state: BattleState,
  routine: NormalizedRoutine,
  onceCompleted: Set<string>,
  useCounts: Map<string, number>,
): boolean {
  const routineId = routine.id;
  if (routine.once && onceCompleted.has(routineId)) return false;

  const maxTriggers = routine["max_triggers"];
  if (maxTriggers !== undefined && maxTriggers !== null) {
    if ((useCounts.get(routineId) ?? 0) >= Number(maxTriggers)) return false;
  }

  if (state.roundNumber < routine.start_round) return false;
  const endRound = routine["end_round"];
  if (endRound !== undefined && endRound !== null && state.roundNumber > Number(endRound)) return false;

  const cadence = Math.max(1, routine.cadence_rounds);
  if ((state.roundNumber - routine.start_round) % cadence !== 0) return false;

  const enabledFlag = routine["enabled_flag"];
  if (enabledFlag !== undefined && enabledFlag !== null && !state.flags[String(enabledFlag)]) return false;
  const disabledFlag = routine["disabled_flag"];
  if (disabledFlag !== undefined && disabledFlag !== null && state.flags[String(disabledFlag)]) return false;

  return true;
}

function buildRoutineCommand(actor: string, routine: NormalizedRoutine): Record<string, unknown> {
  const command: Record<string, unknown> = {
    type: "run_hazard_routine",
    actor,
    hazard_id: routine.hazard_id,
    source_name: routine.source_name,
    source_type: routine.source_type,
    target_policy: routine.target_policy,
  };
  for (const key of ["center_x", "center_y", "target", "model_path"]) {
    if (key in routine) command[key] = routine[key];
  }
  return command;
}

// ---------------------------------------------------------------------------
// Mission events
// ---------------------------------------------------------------------------

interface NormalizedMissionEvent extends Record<string, unknown> {
  id: string;
  trigger: string;
  start_round: number;
  once: boolean;
  commands: Record<string, unknown>[];
}

function normalizeMissionEvents(scenario: Record<string, unknown>): NormalizedMissionEvent[] {
  const out: NormalizedMissionEvent[] = [];

  const rawEvents = (scenario["mission_events"] as Record<string, unknown>[]) ?? [];
  for (let idx = 0; idx < rawEvents.length; idx++) {
    const raw = rawEvents[idx];
    out.push({
      ...raw,
      id: String(raw["id"] ?? `mission_event_${idx + 1}`),
      trigger: String(raw["trigger"] ?? "turn_start"),
      start_round: Number(raw["start_round"] ?? 1),
      once: Boolean(raw["once"] ?? true),
      commands: (raw["commands"] as Record<string, unknown>[]) ?? [],
    });
  }

  const rawWaves = (scenario["reinforcement_waves"] as Record<string, unknown>[]) ?? [];
  for (let idx = 0; idx < rawWaves.length; idx++) {
    const wave = rawWaves[idx];
    const commands: Record<string, unknown>[] = [];
    const placementPolicy = String(wave["placement_policy"] ?? "exact");
    const spendAction = Boolean(wave["spend_action"] ?? false);
    for (const unit of (wave["units"] as Record<string, unknown>[]) ?? []) {
      commands.push({
        type: "spawn_unit",
        placement_policy: placementPolicy,
        spend_action: spendAction,
        unit: { ...unit },
      });
    }
    if ("set_flag" in wave) {
      commands.push({
        type: "set_flag",
        flag: String(wave["set_flag"]),
        value: Boolean(wave["set_flag_value"] ?? true),
      });
    }
    const event: NormalizedMissionEvent = {
      id: String(wave["id"] ?? `reinforcement_wave_${idx + 1}`),
      trigger: String(wave["trigger"] ?? "round_start"),
      once: Boolean(wave["once"] ?? true),
      start_round: 1,
      commands,
    };
    for (const key of ["round", "start_round", "end_round", "active_unit", "enabled_flag", "disabled_flag"]) {
      if (key in wave) event[key] = wave[key];
    }
    out.push(event);
  }
  return out;
}

function missionEventEligible(
  state: BattleState,
  missionEvent: NormalizedMissionEvent,
  onceCompleted: Set<string>,
): boolean {
  const missionId = missionEvent.id;
  if (missionEvent.once && onceCompleted.has(missionId)) return false;

  const trigger = missionEvent.trigger;
  if (trigger === "round_start") {
    if (state.turnIndex !== 0) return false;
  } else if (trigger === "turn_start") {
    // always eligible when checked at turn start
  } else if (trigger === "unit_dead") {
    const unitId = String(missionEvent["unit_id"] ?? "");
    const unit = state.units[unitId];
    if (!unit || unitAlive(unit)) return false;
  } else if (trigger === "unit_alive") {
    const unitId = String(missionEvent["unit_id"] ?? "");
    const unit = state.units[unitId];
    if (!unit || !unitAlive(unit)) return false;
  } else if (trigger === "flag_set") {
    const flag = String(missionEvent["flag"] ?? "");
    const expected = Boolean(missionEvent["value"] ?? true);
    if (!flag || (state.flags[flag] ?? false) !== expected) return false;
  } else {
    return false;
  }

  const roundExact = missionEvent["round"];
  if (roundExact !== undefined && roundExact !== null && state.roundNumber !== Number(roundExact)) return false;
  const startRound = Number(missionEvent["start_round"] ?? 1);
  if (state.roundNumber < startRound) return false;
  const endRound = missionEvent["end_round"];
  if (endRound !== undefined && endRound !== null && state.roundNumber > Number(endRound)) return false;

  const activeUnit = missionEvent["active_unit"];
  if (activeUnit !== undefined && activeUnit !== null && String(activeUnit) !== activeUnitId(state)) return false;

  const enabledFlag = missionEvent["enabled_flag"];
  if (enabledFlag !== undefined && enabledFlag !== null && !state.flags[String(enabledFlag)]) return false;
  const disabledFlag = missionEvent["disabled_flag"];
  if (disabledFlag !== undefined && disabledFlag !== null && state.flags[String(disabledFlag)]) return false;

  return true;
}

function missionEventCommands(
  state: BattleState,
  missionEvent: NormalizedMissionEvent,
): [Record<string, unknown>[], string] {
  const hasBranch = "then_commands" in missionEvent || "else_commands" in missionEvent;
  if (!hasBranch) {
    return [missionEvent.commands.map((cmd) => ({ ...cmd })), "default"];
  }

  let conditionMet = true;
  const ifFlag = missionEvent["if_flag"];
  if (ifFlag !== undefined && ifFlag !== null) {
    const expected = Boolean(missionEvent["if_flag_value"] ?? true);
    conditionMet = (state.flags[String(ifFlag)] ?? false) === expected;
  }

  if (conditionMet) {
    return [
      ((missionEvent["then_commands"] as Record<string, unknown>[]) ?? []).map((cmd) => ({ ...cmd })),
      "then",
    ];
  }
  return [
    ((missionEvent["else_commands"] as Record<string, unknown>[]) ?? []).map((cmd) => ({ ...cmd })),
    "else",
  ];
}

function buildMissionCommand(rawCommand: Record<string, unknown>, activeUnit: string): Record<string, unknown> {
  const command = { ...rawCommand };
  if (!("actor" in command)) command["actor"] = activeUnit;
  return command;
}

// ---------------------------------------------------------------------------
// Enemy policy
// ---------------------------------------------------------------------------

interface EnemyPolicy {
  enabled: boolean;
  teams: string[];
  action: string;
  content_entry_id: string | null;
  dc: number | null;
  include_rationale: boolean;
  auto_end_turn: boolean;
}

function normalizeEnemyPolicy(scenario: Record<string, unknown>): EnemyPolicy {
  const raw = (scenario["enemy_policy"] as Record<string, unknown>) ?? {};
  const enabled = Boolean(raw["enabled"] ?? false);
  const teamsRaw = raw["teams"];
  let teams: string[];
  if (Array.isArray(teamsRaw) && teamsRaw.length > 0) {
    teams = teamsRaw.map(String);
  } else {
    teams = ["enemy"];
  }
  return {
    enabled,
    teams,
    action: String(raw["action"] ?? "strike_nearest"),
    content_entry_id: raw["content_entry_id"] != null ? String(raw["content_entry_id"]) : null,
    dc: raw["dc"] != null ? Number(raw["dc"]) : null,
    include_rationale: Boolean(raw["include_rationale"] ?? false),
    auto_end_turn: Boolean(raw["auto_end_turn"] ?? true),
  };
}

function enemyCandidatesForActor(state: BattleState, actorId: string): Array<[string, number]> {
  const actor = state.units[actorId];
  const enemies = Object.values(state.units).filter(
    (u) => unitAlive(u) && u.team !== actor.team && u.unitId !== actorId,
  );
  if (enemies.length === 0) return [];
  return enemies
    .map((u): [string, number] => [u.unitId, Math.abs(u.x - actor.x) + Math.abs(u.y - actor.y)])
    .sort(([idA, dA], [idB, dB]) => {
      const dd = dA - dB;
      if (dd !== 0) return dd;
      return idA.localeCompare(idB);
    });
}

function enemyPolicyDecision(
  state: BattleState,
  policy: EnemyPolicy,
): [Record<string, unknown>, Record<string, unknown>] {
  const actorId = activeUnitId(state);
  const actor = state.units[actorId];
  if (!unitAlive(actor)) {
    return [{ type: "end_turn", actor: actorId }, { reason_code: "actor_not_alive" }];
  }
  if (actor.actionsRemaining <= 0) {
    return [{ type: "end_turn", actor: actorId }, { reason_code: "no_actions_remaining" }];
  }
  if (!policy.teams.includes(actor.team)) {
    return [{ type: "end_turn", actor: actorId }, { reason_code: "team_not_controlled" }];
  }

  const action = policy.action;
  const candidates = enemyCandidatesForActor(state, actorId);

  if (action === "strike_nearest") {
    if (candidates.length > 0) {
      const [targetId, distance] = candidates[0];
      return [
        { type: "strike", actor: actorId, target: targetId },
        { reason_code: "nearest_enemy", selected_target: targetId, distance, candidate_count: candidates.length },
      ];
    }
    return [{ type: "end_turn", actor: actorId }, { reason_code: "no_enemy_target" }];
  }
  if (action === "cast_spell_entry_nearest") {
    if (candidates.length > 0) {
      const [targetId, distance] = candidates[0];
      return [
        {
          type: "cast_spell",
          actor: actorId,
          content_entry_id: policy.content_entry_id ?? "",
          target: targetId,
          dc: policy.dc ?? 0,
        },
        {
          reason_code: "nearest_enemy_for_spell",
          selected_target: targetId,
          distance,
          candidate_count: candidates.length,
          content_entry_id: policy.content_entry_id ?? "",
        },
      ];
    }
    return [{ type: "end_turn", actor: actorId }, { reason_code: "no_enemy_target" }];
  }
  if (action === "use_feat_entry_self") {
    return [
      { type: "use_feat", actor: actorId, content_entry_id: policy.content_entry_id ?? "", target: actorId },
      { reason_code: "self_target_feat", selected_target: actorId, content_entry_id: policy.content_entry_id ?? "" },
    ];
  }
  if (action === "use_item_entry_self") {
    return [
      { type: "use_item", actor: actorId, content_entry_id: policy.content_entry_id ?? "", target: actorId },
      { reason_code: "self_target_item", selected_target: actorId, content_entry_id: policy.content_entry_id ?? "" },
    ];
  }
  if (action === "interact_entry_self") {
    return [
      { type: "interact", actor: actorId, content_entry_id: policy.content_entry_id ?? "", target: actorId },
      {
        reason_code: "self_target_interact",
        selected_target: actorId,
        content_entry_id: policy.content_entry_id ?? "",
      },
    ];
  }
  return [{ type: "end_turn", actor: actorId }, { reason_code: "unknown_action" }];
}

// ---------------------------------------------------------------------------
// Objective / battle-end check
// ---------------------------------------------------------------------------

function checkBattleEnd(
  events: Record<string, unknown>[],
  state: BattleState,
  objectives: Array<Record<string, unknown>>,
  objectiveStatuses: Record<string, boolean>,
  stepCounter: number,
): [boolean, Record<string, boolean>] {
  if (objectives.length > 0) {
    const objectiveState = evaluateObjectives(state, objectives);
    const statuses = { ...objectiveState.statuses };
    const changed = Object.keys(statuses).some((k) => statuses[k] !== objectiveStatuses[k]);
    if (changed) {
      events.push({
        event_id: `ev_obj_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "objective_update",
        payload: {
          statuses,
          victory_met: objectiveState.victoryMet,
          defeat_met: objectiveState.defeatMet,
        },
      });
      objectiveStatuses = statuses;
    }
    if (objectiveState.defeatMet || objectiveState.victoryMet) {
      events.push({
        event_id: `ev_done_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "battle_end",
        payload: {
          reason: "objectives",
          outcome: objectiveState.defeatMet ? "defeat" : "victory",
          objective_statuses: objectiveStatuses,
        },
      });
      return [true, objectiveStatuses];
    }
  }

  const teams = aliveTeams(state);
  if (teams.size <= 1) {
    events.push({
      event_id: `ev_done_${String(stepCounter).padStart(4, "0")}`,
      round: state.roundNumber,
      active_unit: activeUnitId(state),
      type: "battle_end",
      payload: { winner_team: teams.size === 1 ? [...teams][0] : null },
    });
    return [true, objectiveStatuses];
  }

  return [false, objectiveStatuses];
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  battleId: string;
  seed: number;
  enginePhase: number;
  executedCommands: number;
  autoExecutedCommands: number;
  stopReason: string;
  eventCount: number;
  replayHash: string;
  finalState: Record<string, unknown>;
  contentPackContext: Record<string, unknown>;
  commandAuthoringCatalog: Record<string, unknown>;
  events: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Main run function (async — uses pre-resolved content context)
// ---------------------------------------------------------------------------

export async function runScenario(
  scenario: Record<string, unknown>,
  initialState: BattleState,
  contentContext: ContentContext,
  enginePhase = DEFAULT_ENGINE_PHASE,
): Promise<ScenarioResult> {
  const objectives = expandObjectivePacks(
    (scenario["objectives"] as Array<Record<string, unknown>>) ?? [],
    (scenario["objective_packs"] as Array<Record<string, unknown>>) ?? [],
  );
  const routinesByUnit = normalizeHazardRoutines(scenario);
  const missionEvents = normalizeMissionEvents(scenario);
  const enemyPolicy = normalizeEnemyPolicy(scenario);

  const rng = new DeterministicRNG(initialState.seed);
  let state = initialState;
  const events: Record<string, unknown>[] = [];

  if (contentContext.packs.length > 0) {
    events.push({
      event_id: "ev_pack_000000",
      round: state.roundNumber,
      active_unit: activeUnitId(state),
      type: "content_pack_resolved",
      payload: {
        engine_phase: enginePhase,
        selected_pack_id: contentContext.selectedPackId,
        pack_count: contentContext.packs.length,
        entry_count: Object.keys(contentContext.entryLookup).length,
      },
    });
  }

  events.push({
    event_id: "ev_000000",
    round: state.roundNumber,
    active_unit: activeUnitId(state),
    type: "turn_start",
    payload: { active_unit: activeUnitId(state), round: state.roundNumber },
  });

  let scriptedExecuted = 0;
  let autoExecuted = 0;
  let stepCounter = 0;
  const maxSteps = Number(scenario["max_steps"] ?? ((scenario["commands"] as unknown[]).length + 1000));
  let objectiveStatuses: Record<string, boolean> = {};
  const missionTurnExecuted = new Set<string>();
  const missionOnceCompleted = new Set<string>();
  const routineTurnExecuted = new Set<string>();
  const routineOnceCompleted = new Set<string>();
  const routineUseCounts = new Map<string, number>();
  let ended = false;
  let commandIndex = 0;
  const commands = [...(scenario["commands"] as Record<string, unknown>[])];
  let stopReason = "script_exhausted";

  [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
  if (ended) stopReason = "battle_end";

  while (stepCounter < maxSteps && !ended) {
    const currentActiveUnitId = activeUnitId(state);
    let ranMissionEvent = false;
    let ranRoutine = false;

    // --- Mission events ---
    for (const missionEvent of missionEvents) {
      const missionId = missionEvent.id;
      const turnKey = `${state.roundNumber}:${state.turnIndex}:${missionId}`;
      if (missionTurnExecuted.has(turnKey)) continue;
      if (!missionEventEligible(state, missionEvent, missionOnceCompleted)) continue;

      const [eventCommands, branch] = missionEventCommands(state, missionEvent);
      if (eventCommands.length === 0) {
        missionTurnExecuted.add(turnKey);
        if (missionEvent.once) missionOnceCompleted.add(missionId);
        continue;
      }

      events.push({
        event_id: `ev_mission_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "mission_event",
        payload: {
          id: missionId,
          trigger: missionEvent.trigger,
          branch,
          command_count: eventCommands.length,
        },
      });
      ranMissionEvent = true;
      missionTurnExecuted.add(turnKey);
      if (missionEvent.once) missionOnceCompleted.add(missionId);

      for (const rawCmd of eventCommands) {
        const missionCmd = buildMissionCommand(rawCmd, activeUnitId(state));
        let materializedCmd: Record<string, unknown>;
        try {
          materializedCmd = materializeContentEntryCommand(missionCmd, contentContext);
        } catch (exc) {
          events.push({
            event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
            round: state.roundNumber,
            active_unit: activeUnitId(state),
            type: "command_error",
            payload: { command: missionCmd, error: String(exc) },
          });
          stopReason = "command_error";
          ended = true;
          break;
        }
        try {
          const [nextState, newEvents] = applyCommand(state, materializedCmd, rng);
          state = nextState;
          events.push(...newEvents);
        } catch (exc) {
          events.push({
            event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
            round: state.roundNumber,
            active_unit: activeUnitId(state),
            type: "command_error",
            payload: { command: materializedCmd, error: String(exc) },
          });
          stopReason = "command_error";
          ended = true;
          break;
        }
        stepCounter++;
        autoExecuted++;

        [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
        if (ended) { stopReason = "battle_end"; break; }
      }
      if (ended) break;
    }
    if (ended) break;
    if (ranMissionEvent) continue;

    // --- Hazard routines ---
    const unitRoutines = routinesByUnit.get(currentActiveUnitId) ?? [];
    for (const routine of unitRoutines) {
      const routineId = routine.id;
      const turnKey = `${state.roundNumber}:${state.turnIndex}:${routineId}`;
      if (routineTurnExecuted.has(turnKey)) continue;
      if (!routineEligible(state, routine, routineOnceCompleted, routineUseCounts)) continue;

      const routineCmd = buildRoutineCommand(currentActiveUnitId, routine);
      try {
        const [nextState, newEvents] = applyCommand(state, routineCmd, rng);
        state = nextState;
        events.push(...newEvents);
      } catch (exc) {
        events.push({
          event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
          round: state.roundNumber,
          active_unit: activeUnitId(state),
          type: "command_error",
          payload: { command: routineCmd, error: String(exc) },
        });
        stopReason = "command_error";
        ended = true;
        break;
      }
      stepCounter++;
      autoExecuted++;
      ranRoutine = true;
      routineTurnExecuted.add(turnKey);
      routineUseCounts.set(routineId, (routineUseCounts.get(routineId) ?? 0) + 1);
      if (routine.once) routineOnceCompleted.add(routineId);

      [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
      if (ended) { stopReason = "battle_end"; break; }

      // auto end turn after routine
      if (
        routine.auto_end_turn &&
        activeUnitId(state) === currentActiveUnitId &&
        unitAlive(state.units[currentActiveUnitId])
      ) {
        const endTurnCmd = { type: "end_turn", actor: currentActiveUnitId };
        try {
          const [nextState, newEvents] = applyCommand(state, endTurnCmd, rng);
          state = nextState;
          events.push(...newEvents);
        } catch (exc) {
          events.push({
            event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
            round: state.roundNumber,
            active_unit: activeUnitId(state),
            type: "command_error",
            payload: { command: endTurnCmd, error: String(exc) },
          });
          stopReason = "command_error";
          ended = true;
          break;
        }
        stepCounter++;
        autoExecuted++;
        [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
        if (ended) { stopReason = "battle_end"; break; }
      }
    }
    if (ended) break;
    if (ranRoutine) continue;

    // --- Scripted commands / enemy policy ---
    if (commandIndex >= commands.length) {
      if (!enemyPolicy.enabled) break;

      const policyActorId = activeUnitId(state);
      const [policyCmdRaw, policyRationale] = enemyPolicyDecision(state, enemyPolicy);
      let policyCmd: Record<string, unknown>;
      try {
        policyCmd = materializeContentEntryCommand(policyCmdRaw, contentContext);
      } catch (exc) {
        events.push({
          event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
          round: state.roundNumber,
          active_unit: activeUnitId(state),
          type: "command_error",
          payload: { command: policyCmdRaw, error: String(exc) },
        });
        stopReason = "command_error";
        break;
      }

      events.push({
        event_id: `ev_policy_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "enemy_policy_decision",
        payload: enemyPolicy.include_rationale
          ? { command: policyCmd, rationale: policyRationale }
          : { command: policyCmd },
      });

      try {
        const [nextState, newEvents] = applyCommand(state, policyCmd, rng);
        state = nextState;
        events.push(...newEvents);
      } catch {
        if (policyCmd["type"] !== "end_turn") {
          const fallback = { type: "end_turn", actor: activeUnitId(state) };
          try {
            const [nextState, newEvents] = applyCommand(state, fallback, rng);
            state = nextState;
            events.push(...newEvents);
            policyCmd = fallback;
          } catch (exc2) {
            events.push({
              event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
              round: state.roundNumber,
              active_unit: activeUnitId(state),
              type: "command_error",
              payload: { command: fallback, error: String(exc2) },
            });
            stopReason = "command_error";
            break;
          }
        } else {
          events.push({
            event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
            round: state.roundNumber,
            active_unit: activeUnitId(state),
            type: "command_error",
            payload: { command: policyCmd, error: "enemy_policy_failed" },
          });
          stopReason = "command_error";
          break;
        }
      }
      autoExecuted++;
      stepCounter++;

      [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
      if (ended) { stopReason = "battle_end"; continue; }

      if (
        enemyPolicy.auto_end_turn &&
        policyCmd["type"] !== "end_turn" &&
        activeUnitId(state) === policyActorId &&
        unitAlive(state.units[policyActorId])
      ) {
        const endTurnCmd = { type: "end_turn", actor: policyActorId };
        try {
          const [nextState, endEvents] = applyCommand(state, endTurnCmd, rng);
          state = nextState;
          events.push(...endEvents);
        } catch (exc) {
          events.push({
            event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
            round: state.roundNumber,
            active_unit: activeUnitId(state),
            type: "command_error",
            payload: { command: endTurnCmd, error: String(exc) },
          });
          stopReason = "command_error";
          break;
        }
        autoExecuted++;
        stepCounter++;

        [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
        if (ended) stopReason = "battle_end";
      }
      continue;
    }

    // --- Execute next scripted command ---
    const cmd = commands[commandIndex];
    let commandForTurn: Record<string, unknown>;
    try {
      commandForTurn = materializeContentEntryCommand(cmd, contentContext);
    } catch (exc) {
      events.push({
        event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "command_error",
        payload: { command: cmd, error: String(exc) },
      });
      stopReason = "command_error";
      break;
    }

    if (commandForTurn["actor"] !== activeUnitId(state)) {
      events.push({
        event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "command_error",
        payload: {
          command: commandForTurn,
          error: `actor ${commandForTurn["actor"]} is not active unit ${activeUnitId(state)}`,
        },
      });
      stopReason = "command_error";
      break;
    }

    try {
      const [nextState, newEvents] = applyCommand(state, commandForTurn, rng);
      state = nextState;
      events.push(...newEvents);
    } catch (exc) {
      events.push({
        event_id: `ev_error_${String(stepCounter).padStart(4, "0")}`,
        round: state.roundNumber,
        active_unit: activeUnitId(state),
        type: "command_error",
        payload: { command: commandForTurn, error: String(exc) },
      });
      stopReason = "command_error";
      break;
    }
    commandIndex++;
    scriptedExecuted++;
    stepCounter++;

    [ended, objectiveStatuses] = checkBattleEnd(events, state, objectives, objectiveStatuses, stepCounter);
    if (ended) stopReason = "battle_end";
  }

  if (!ended && stepCounter >= maxSteps) stopReason = "max_steps";

  const hash = await replayHash(events);

  const catalog = buildCommandAuthoringCatalog(contentContext);

  return {
    battleId: state.battleId,
    seed: state.seed,
    enginePhase,
    executedCommands: scriptedExecuted,
    autoExecutedCommands: autoExecuted,
    stopReason,
    eventCount: events.length,
    replayHash: hash,
    finalState: stateSnapshot(state),
    contentPackContext: {
      selected_pack_id: contentContext.selectedPackId,
      packs: contentContext.packs,
      entry_lookup: contentContext.entryLookup,
    },
    commandAuthoringCatalog: catalog as unknown as Record<string, unknown>,
    events,
  };
}
