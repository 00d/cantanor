/**
 * Interactive battle orchestration — post-command logic for browser play.
 *
 * Provides:
 *   - Content-entry command materialization (fills in spell/feat/item details
 *     from a loaded content pack before handing to the reducer)
 *   - Objective evaluation and battle-end detection
 *   - Enemy AI policy decision-making
 *
 * This module intentionally avoids touching scenarioRunner.ts so the test
 * suite remains unaffected.
 */

import { evaluateObjectives, expandObjectivePacks } from "../engine/objectives";
import { BattleState, activeUnitId, unitAlive } from "../engine/state";
import { type ContentContext } from "./contentPackLoader";
import { ReductionError } from "../engine/reducer";
import { hasLineOfSight } from "../grid/los";
import { stepToward } from "../grid/movement";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnemyPolicy {
  enabled: boolean;
  teams: string[];
  action: string;
  contentEntryId: string | null;
  dc: number | null;
  autoEndTurn: boolean;
}

export interface OrchestratorConfig {
  enemyPolicy: EnemyPolicy;
  objectives: Array<Record<string, unknown>>;
  /** Teams directly controlled by the player. Hard-coded to ['pc'] in Phase 10. */
  playerTeams: string[];
}

export type BattleOutcome = "victory" | "defeat" | "draw";

export interface BattleEndResult {
  ended: boolean;
  outcome: BattleOutcome | null;
}

// ---------------------------------------------------------------------------
// Config construction
// ---------------------------------------------------------------------------

export function buildOrchestratorConfig(rawScenario: Record<string, unknown>): OrchestratorConfig {
  const raw = (rawScenario["enemy_policy"] as Record<string, unknown>) ?? {};
  const teamsRaw = raw["teams"];
  const teams: string[] = Array.isArray(teamsRaw) && teamsRaw.length > 0
    ? teamsRaw.map(String)
    : ["enemy"];

  const enemyPolicy: EnemyPolicy = {
    enabled: Boolean(raw["enabled"] ?? false),
    teams,
    action: String(raw["action"] ?? "strike_nearest"),
    contentEntryId: raw["content_entry_id"] != null ? String(raw["content_entry_id"]) : null,
    dc: raw["dc"] != null ? Number(raw["dc"]) : null,
    autoEndTurn: Boolean(raw["auto_end_turn"] ?? true),
  };

  const rawObjectives = (rawScenario["objectives"] as Array<Record<string, unknown>>) ?? [];
  const rawPacks = (rawScenario["objective_packs"] as Array<Record<string, unknown>>) ?? [];
  const objectives = expandObjectivePacks(rawObjectives, rawPacks);

  return {
    enemyPolicy,
    objectives,
    playerTeams: ["pc"],
  };
}

// ---------------------------------------------------------------------------
// Content-entry materialization
// ---------------------------------------------------------------------------

function defaultCommandIdFromEntry(entryId: string): string {
  return entryId.includes(".") ? entryId.split(".", 2)[1] : entryId;
}

/**
 * Merges content pack entry payload into a raw command that carries a
 * `content_entry_id`.  Returns the original command unchanged if no entry id
 * is present or if the command type does not support entries.
 */
export function materializeRawCommand(
  command: Record<string, unknown>,
  contentContext: ContentContext,
): Record<string, unknown> {
  const entryIdRaw = command["content_entry_id"];
  if (entryIdRaw === undefined || entryIdRaw === null) return command;
  const entryId = String(entryIdRaw);

  const entry = contentContext.entryLookup[entryId];
  if (!entry) throw new ReductionError(`unknown content entry: ${entryId}`);

  const commandType = String(command["type"] ?? "");
  const allowed = ["cast_spell", "use_feat", "use_item", "interact"];
  if (!allowed.includes(commandType)) {
    throw new ReductionError(`content_entry_id unsupported for command type: ${commandType}`);
  }

  const payloadTemplate = { ...entry.payload };
  const templateType = payloadTemplate["command_type"];
  if (templateType !== undefined && String(templateType) !== commandType) {
    throw new ReductionError(
      `content entry ${entryId} command_type mismatch: ${templateType} vs ${commandType}`,
    );
  }
  delete payloadTemplate["command_type"];

  const merged: Record<string, unknown> = { ...payloadTemplate, ...command };
  if (entry.usesPerDay != null) {
    merged["uses_per_day"] = entry.usesPerDay;
  }

  if (commandType === "cast_spell" && !merged["spell_id"]) {
    merged["spell_id"] = defaultCommandIdFromEntry(entryId);
  } else if (commandType === "use_feat" && !merged["feat_id"]) {
    merged["feat_id"] = defaultCommandIdFromEntry(entryId);
  } else if (commandType === "use_item" && !merged["item_id"]) {
    merged["item_id"] = defaultCommandIdFromEntry(entryId);
  } else if (commandType === "interact" && !merged["interact_id"]) {
    merged["interact_id"] = defaultCommandIdFromEntry(entryId);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Objective / battle-end check
// ---------------------------------------------------------------------------

function aliveTeams(state: BattleState): Set<string> {
  const teams = new Set<string>();
  for (const u of Object.values(state.units)) {
    if (unitAlive(u)) teams.add(u.team);
  }
  return teams;
}

export function checkBattleEnd(
  state: BattleState,
  config: OrchestratorConfig,
): BattleEndResult {
  if (config.objectives.length > 0) {
    const eval_ = evaluateObjectives(state, config.objectives);
    if (eval_.victoryMet) return { ended: true, outcome: "victory" };
    if (eval_.defeatMet) return { ended: true, outcome: "defeat" };
  }

  const teams = aliveTeams(state);
  if (teams.size <= 1) {
    // Determine winner from surviving team
    const [winner] = [...teams];
    const outcome: BattleOutcome = winner
      ? config.playerTeams.includes(winner) ? "victory" : "defeat"
      : "draw";
    return { ended: true, outcome };
  }

  return { ended: false, outcome: null };
}

// ---------------------------------------------------------------------------
// Enemy AI policy
// ---------------------------------------------------------------------------

interface EnemyCandidate {
  unitId: string;
  /** Chebyshev distance — matches PF2e reach rules. */
  dist: number;
  hasLos: boolean;
}

function enemyCandidates(state: BattleState, actorId: string): EnemyCandidate[] {
  const actor = state.units[actorId];
  return Object.values(state.units)
    .filter((u) => unitAlive(u) && u.team !== actor.team)
    .map((u) => ({
      unitId: u.unitId,
      dist: Math.max(Math.abs(u.x - actor.x), Math.abs(u.y - actor.y)),
      hasLos: hasLineOfSight(state, actor, u),
    }))
    .sort((a, b) => a.dist - b.dist || a.unitId.localeCompare(b.unitId));
}

/**
 * Decides the next command for the AI-controlled active unit.
 * Returns a raw command ready for materialization then dispatch.
 */
export function getAiCommand(
  state: BattleState,
  policy: EnemyPolicy,
): Record<string, unknown> {
  const actorId = activeUnitId(state);
  const actor = state.units[actorId];

  if (!unitAlive(actor) || actor.actionsRemaining <= 0 || !policy.teams.includes(actor.team)) {
    return { type: "end_turn", actor: actorId };
  }

  const candidates = enemyCandidates(state, actorId);
  const reach = actor.reach ?? 1;

  switch (policy.action) {
    case "strike_nearest": {
      // Strike if any enemy is within reach with LOS; otherwise move toward
      // the nearest enemy; if no move helps, end turn.
      const inReach = candidates.find((c) => c.dist <= reach && c.hasLos);
      if (inReach) {
        return { type: "strike", actor: actorId, target: inReach.unitId };
      }
      if (candidates.length > 0) {
        const targetUnit = state.units[candidates[0].unitId];
        const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
        if (step) {
          return { type: "move", actor: actorId, x: step[0], y: step[1] };
        }
      }
      return { type: "end_turn", actor: actorId };
    }
    case "cast_spell_entry_nearest": {
      const target = candidates.find((c) => c.hasLos);
      if (target) {
        return {
          type: "cast_spell",
          actor: actorId,
          content_entry_id: policy.contentEntryId ?? "",
          target: target.unitId,
          dc: policy.dc ?? 15,
        };
      }
      // Approach if no LOS
      if (candidates.length > 0) {
        const targetUnit = state.units[candidates[0].unitId];
        const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
        if (step) return { type: "move", actor: actorId, x: step[0], y: step[1] };
      }
      return { type: "end_turn", actor: actorId };
    }
    case "use_feat_entry_self": {
      return {
        type: "use_feat",
        actor: actorId,
        content_entry_id: policy.contentEntryId ?? "",
        target: actorId,
      };
    }
    case "use_item_entry_self": {
      return {
        type: "use_item",
        actor: actorId,
        content_entry_id: policy.contentEntryId ?? "",
        target: actorId,
      };
    }
    default:
      return { type: "end_turn", actor: actorId };
  }
}

/** True when the active unit should be controlled by AI (not the player). */
export function isAiUnit(state: BattleState, config: OrchestratorConfig): boolean {
  const id = activeUnitId(state);
  const unit = state.units[id];
  return !!unit && !config.playerTeams.includes(unit.team);
}
