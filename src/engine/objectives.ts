/**
 * Objective evaluation for scenario-driven encounters.
 * Mirrors engine/core/objectives.py
 *
 * Pathfinder 2e ORC encounter objectives: victory/defeat conditions.
 */

import { BattleState, unitAlive } from "./state";

function objectiveMet(
  state: BattleState,
  objective: Record<string, unknown>,
): boolean {
  const kind = String(objective["type"] ?? "");
  if (kind === "team_eliminated") {
    const team = String(objective["team"] ?? "");
    return (
      Boolean(team) &&
      !Object.values(state.units).some((u) => unitAlive(u) && u.team === team)
    );
  }
  if (kind === "unit_reach_tile") {
    const unitId = String(objective["unit_id"] ?? "");
    const unit = state.units[unitId];
    if (!unit || !unitAlive(unit)) return false;
    return (
      unit.x === Number(objective["x"] ?? -99999) &&
      unit.y === Number(objective["y"] ?? -99999)
    );
  }
  if (kind === "flag_set") {
    const flag = String(objective["flag"] ?? "");
    const expected = Boolean(objective["value"] ?? true);
    return Boolean(flag) && (state.flags[flag] ?? false) === expected;
  }
  if (kind === "round_at_least") {
    return state.roundNumber >= Number(objective["round"] ?? 0);
  }
  if (kind === "unit_dead") {
    const unit = state.units[String(objective["unit_id"] ?? "")];
    return unit !== undefined && !unitAlive(unit);
  }
  if (kind === "unit_alive") {
    const unit = state.units[String(objective["unit_id"] ?? "")];
    return unit !== undefined && unitAlive(unit);
  }
  return false;
}

export interface ObjectiveEvaluation {
  statuses: Record<string, boolean>;
  victoryMet: boolean;
  defeatMet: boolean;
  victoryObjectives: string[];
  defeatObjectives: string[];
}

export function evaluateObjectives(
  state: BattleState,
  objectives: Array<Record<string, unknown>>,
): ObjectiveEvaluation {
  const statuses: Record<string, boolean> = {};
  const victoryIds: string[] = [];
  const defeatIds: string[] = [];

  for (let idx = 0; idx < objectives.length; idx++) {
    const objective = objectives[idx];
    const objectiveId = String(objective["id"] ?? `objective_${idx + 1}`);
    const met = objectiveMet(state, objective);
    statuses[objectiveId] = met;
    const result = String(objective["result"] ?? "victory").toLowerCase();
    if (result === "defeat") {
      defeatIds.push(objectiveId);
    } else {
      victoryIds.push(objectiveId);
    }
  }

  const victoryMet =
    victoryIds.length > 0 && victoryIds.every((oid) => statuses[oid] ?? false);
  const defeatMet = defeatIds.some((oid) => statuses[oid] ?? false);

  return {
    statuses,
    victoryMet,
    defeatMet,
    victoryObjectives: victoryIds,
    defeatObjectives: defeatIds,
  };
}

export function expandObjectivePacks(
  objectives: Array<Record<string, unknown>>,
  objectivePacks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = objectives.map((obj) => ({
    ...obj,
  }));
  for (let idx = 0; idx < objectivePacks.length; idx++) {
    const pack = objectivePacks[idx];
    const packId = String(pack["id"] ?? `pack_${idx + 1}`);
    const packType = String(pack["type"] ?? "");

    if (packType === "eliminate_team") {
      out.push({
        id: `${packId}_eliminate_team`,
        type: "team_eliminated",
        team: String(pack["team"] ?? ""),
        result: String(pack["result"] ?? "victory"),
      });
    } else if (packType === "escape_unit") {
      const unitId = String(pack["unit_id"] ?? "");
      out.push({
        id: `${packId}_escape`,
        type: "unit_reach_tile",
        unit_id: unitId,
        x: Number(pack["x"] ?? 0),
        y: Number(pack["y"] ?? 0),
        result: "victory",
      });
      if (pack["defeat_on_death"] !== false) {
        out.push({
          id: `${packId}_unit_dead`,
          type: "unit_dead",
          unit_id: unitId,
          result: "defeat",
        });
      }
    } else if (packType === "holdout") {
      out.push({
        id: `${packId}_holdout_rounds`,
        type: "round_at_least",
        round: Number(pack["round"] ?? 1),
        result: "victory",
      });
      const protectTeam = pack["protect_team"];
      if (typeof protectTeam === "string" && protectTeam) {
        out.push({
          id: `${packId}_protect_team`,
          type: "team_eliminated",
          team: protectTeam,
          result: "defeat",
        });
      }
    }
  }
  return out;
}
