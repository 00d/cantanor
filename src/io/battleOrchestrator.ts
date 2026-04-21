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
import { hasTileLineOfEffect } from "../grid/loe";
import { radiusPoints } from "../grid/areas";
import { tilesFromFeet } from "../grid/map";
import { stepToward } from "../grid/movement";
import { thrownRange } from "../engine/traits";

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

  // ── Area spell rewrite ────────────────────────────────────────────────────
  // When the content entry declares an area shape, the UI dispatches the
  // command as "cast_spell" (so this function's whitelist + the template
  // merge above both work unchanged) with center_x/center_y instead of a
  // target. We then swap the type so the reducer takes its area_save_damage
  // branch. Done post-merge because radius_feet comes from the template, the
  // center comes from the click — both are in `merged` by now.
  //
  // Gate reads payloadTemplate.area (the content-pack author's declaration),
  // NOT merged.area — a malicious dispatch can't inject an area block and
  // turn a single-target spell into an AoE.
  //
  // Only burst is wired today; `shape` is kept in the schema so a later
  // line/cone pass has somewhere to hang its dispatch.
  const areaRaw = payloadTemplate["area"];
  if (commandType === "cast_spell" && areaRaw && typeof areaRaw === "object") {
    const area = areaRaw as Record<string, unknown>;
    const shape = String(area["shape"] ?? "");
    if (shape !== "burst") {
      throw new ReductionError(
        `content entry ${entryId}: area shape '${shape}' not supported (only 'burst')`,
      );
    }
    if (merged["center_x"] === undefined || merged["center_y"] === undefined) {
      throw new ReductionError(
        `content entry ${entryId}: area spell requires center_x/center_y, not target`,
      );
    }
    merged["type"] = "area_save_damage";
    merged["radius_feet"] = Number(area["radius_feet"]);
    // Scrub fields the area_save_damage reducer path doesn't read. Leaving
    // them in is harmless to the reducer (it ignores unknowns) but it makes
    // the event log confusing — a Fireball event shouldn't carry spell_id.
    delete merged["area"];
    delete merged["spell_id"];
    delete merged["target"];
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

// ─── AI area-spell targeting ────────────────────────────────────────────────

interface AiAreaSpec {
  shape: "burst";
  /** The size in tiles (reducer uses tilesFromFeet to convert — we do too). */
  sizeTiles: number;
}

/** Read the area spec from a content-entry payload, or null if single-target.
 *  Same parsing rules as ActionPanel's readAreaShape. Burst-only — cone/line
 *  return null so the policy falls through to approach (matches materialize's
 *  throw on non-burst). */
function readEntryArea(payload: Record<string, unknown> | undefined): AiAreaSpec | null {
  if (!payload) return null;
  const raw = payload["area"];
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (String(a["shape"] ?? "") !== "burst") return null;
  const sizeFeet = Number(a["radius_feet"]);
  if (!Number.isFinite(sizeFeet) || sizeFeet <= 0) return null;
  return { shape: "burst", sizeTiles: tilesFromFeet(sizeFeet) };
}

/** Compute the burst footprint at a given centre — MIRRORS the reducer's
 *  area_save_damage target collection so the AI and the engine agree on who
 *  gets hit. */
function areaFootprint(
  state: BattleState,
  cx: number,
  cy: number,
  sizeTiles: number,
): Set<string> {
  const out = new Set<string>();
  for (const [tx, ty] of radiusPoints(cx, cy, sizeTiles)) {
    if (hasTileLineOfEffect(state, cx, cy, tx, ty)) {
      out.add(`${tx},${ty}`);
    }
  }
  return out;
}

interface AreaPick {
  centerX: number;
  centerY: number;
  /** Enemies hit minus allies hit. Positive = worth casting. */
  score: number;
}

/** Try a set of candidate centre points and return the one that hits the most
 *  enemies net of friendly fire. Candidates are the enemy positions themselves
 *  — the best place to centre a fireball is usually on top of the densest
 *  cluster, and enemy tiles are the cluster nuclei.
 *
 *  Ties broken by highest enemy count (prefer hitting 2+1 over 1+0 even though
 *  both score 1), then by unitId for determinism. */
function pickBestAreaAim(
  state: BattleState,
  actorId: string,
  spec: AiAreaSpec,
  enemyIds: string[],
): AreaPick | null {
  const actor = state.units[actorId];
  const allUnits = Object.values(state.units).filter(unitAlive);

  let best: (AreaPick & { enemies: number; tiebreak: string }) | null = null;

  for (const candId of enemyIds) {
    const cand = state.units[candId];
    const footprint = areaFootprint(state, cand.x, cand.y, spec.sizeTiles);

    let enemies = 0;
    let allies = 0;
    for (const u of allUnits) {
      if (u.unitId === actorId) continue; // include_actor default false
      if (!footprint.has(`${u.x},${u.y}`)) continue;
      if (u.team === actor.team) allies++;
      else enemies++;
    }
    const score = enemies - allies;

    if (
      best === null ||
      score > best.score ||
      (score === best.score && enemies > best.enemies) ||
      (score === best.score && enemies === best.enemies && candId < best.tiebreak)
    ) {
      best = { centerX: cand.x, centerY: cand.y, score, enemies, tiebreak: candId };
    }
  }

  return best;
}

/**
 * Decides the next command for the AI-controlled active unit.
 * Returns a raw command ready for materialization then dispatch.
 *
 * @param contentContext — optional; only needed by `cast_area_entry_best`
 *   which introspects the entry's area block to know the blast shape.
 */
export function getAiCommand(
  state: BattleState,
  policy: EnemyPolicy,
  contentContext?: ContentContext | null,
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
      // Try each weapon: prefer melee when in reach, fall back to ranged.
      const weaponCount = actor.weapons ? actor.weapons.length : 0;
      if (weaponCount > 0) {
        // First pass: try melee weapons against in-reach enemies
        for (let wi = 0; wi < weaponCount; wi++) {
          const w = actor.weapons![wi];
          if (w.type !== "melee") continue;
          const wReach = w.reach ?? 1;
          const inReach = candidates.find((c) => c.dist <= wReach && c.hasLos);
          if (inReach) {
            return { type: "strike", actor: actorId, target: inReach.unitId, weapon_index: wi };
          }
        }
        // Second pass (thrown): melee weapons with thrown_N beyond reach
        for (let wi = 0; wi < weaponCount; wi++) {
          const w = actor.weapons![wi];
          if (w.type !== "melee") continue;
          const thrown = thrownRange(w);
          if (thrown === null) continue;
          const inThrown = candidates.find((c) => c.dist <= thrown && c.hasLos);
          if (inThrown) {
            return { type: "strike", actor: actorId, target: inThrown.unitId, weapon_index: wi };
          }
        }
        // Third pass: try ranged weapons (with ammo)
        for (let wi = 0; wi < weaponCount; wi++) {
          const w = actor.weapons![wi];
          if (w.type !== "ranged") continue;
          // Skip weapons with no ammo
          if (w.ammo != null) {
            const remaining = actor.weaponAmmo?.[wi] ?? 0;
            if (remaining <= 0) continue;
          }
          const maxRange = w.maxRange ?? (w.rangeIncrement ?? 6) * 6;
          const inRange = candidates.find((c) => c.dist <= maxRange && c.dist >= 1 && c.hasLos);
          if (inRange) {
            return { type: "strike", actor: actorId, target: inRange.unitId, weapon_index: wi };
          }
        }
        // Fourth pass: reload an empty weapon if no usable attack was found
        for (let wi = 0; wi < weaponCount; wi++) {
          const w = actor.weapons![wi];
          if (w.ammo != null && w.reload && w.reload > 0) {
            const remaining = actor.weaponAmmo?.[wi] ?? 0;
            if (remaining <= 0 && actor.actionsRemaining >= w.reload) {
              return { type: "reload", actor: actorId, weapon_index: wi };
            }
          }
        }
      } else {
        // No weapons array — use flat fields (melee only, legacy)
        const inReach = candidates.find((c) => c.dist <= reach && c.hasLos);
        if (inReach) {
          return { type: "strike", actor: actorId, target: inReach.unitId };
        }
      }
      // Move toward nearest enemy
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
      const spellEntryId = policy.contentEntryId ?? "";
      const spellEntry = contentContext?.entryLookup[spellEntryId];
      const spellCost = Number(spellEntry?.payload?.["action_cost"] ?? 2);
      if (actor.actionsRemaining < spellCost) {
        // Not enough actions to cast — move toward nearest enemy or end turn.
        if (candidates.length > 0) {
          const targetUnit = state.units[candidates[0].unitId];
          const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
          if (step) return { type: "move", actor: actorId, x: step[0], y: step[1] };
        }
        return { type: "end_turn", actor: actorId };
      }
      const target = candidates.find((c) => c.hasLos);
      if (target) {
        return {
          type: "cast_spell",
          actor: actorId,
          content_entry_id: spellEntryId,
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
    case "cast_area_entry_best": {
      const entryId = policy.contentEntryId ?? "";
      const entry = contentContext?.entryLookup[entryId];
      const areaCost = Number(entry?.payload?.["action_cost"] ?? 2);
      if (actor.actionsRemaining < areaCost) {
        if (candidates.length > 0) {
          const targetUnit = state.units[candidates[0].unitId];
          const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
          if (step) return { type: "move", actor: actorId, x: step[0], y: step[1] };
        }
        return { type: "end_turn", actor: actorId };
      }
      const spec = readEntryArea(entry?.payload);
      if (!spec || candidates.length === 0) {
        // No area spec or no enemies — try to approach, else end turn.
        if (candidates.length > 0) {
          const targetUnit = state.units[candidates[0].unitId];
          const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
          if (step) return { type: "move", actor: actorId, x: step[0], y: step[1] };
        }
        return { type: "end_turn", actor: actorId };
      }

      // Pick the aim point that hits the most enemies net of friendly fire.
      // Only cast when the score is strictly positive — a blast that hits
      // one enemy and one ally (score 0) isn't worth burning the action on.
      const enemyIds = candidates.map((c) => c.unitId);
      const pick = pickBestAreaAim(state, actorId, spec, enemyIds);
      if (pick && pick.score > 0) {
        return {
          type: "cast_spell",
          actor: actorId,
          content_entry_id: entryId,
          center_x: pick.centerX,
          center_y: pick.centerY,
        };
      }

      // No profitable aim — approach the nearest enemy instead.
      const targetUnit = state.units[candidates[0].unitId];
      const step = stepToward(state, actorId, targetUnit.x, targetUnit.y);
      if (step) return { type: "move", actor: actorId, x: step[0], y: step[1] };
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
    case "interact_entry_self": {
      return {
        type: "interact",
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
