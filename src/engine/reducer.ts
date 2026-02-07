/**
 * Deterministic battle reducer.
 * Mirrors engine/core/reducer.py
 *
 * Pure function: (state, command, rng) → [nextState, events]
 * All mutations happen on a deep-cloned copy; original state is never mutated.
 */

import { LifecycleEvent, onApply, processTiming } from "../effects/lifecycle";
import { conePoints, linePoints, radiusPoints } from "../grid/areas";
import { coverAcBonusForUnits, coverGradeForUnits, hasTileLineOfEffect } from "../grid/loe";
import { hasLineOfSight } from "../grid/los";
import { inBounds, isBlocked, isOccupied } from "../grid/map";
import { canStepTo } from "../grid/movement";
import { applyCondition, conditionIsImmune, normalizeConditionName } from "../rules/conditions";
import { applyDamageModifiers, applyDamageToPool, rollDamage } from "../rules/damage";
import { Degree } from "../rules/degrees";
import { resolveCheck } from "../rules/checks";
import { SaveProfile, basicSaveMultiplier, resolveSave } from "../rules/saves";
import { Command, RawCommand } from "./commands";
import { castSpellForecast, strikeForecast } from "./forecast";
import { eventId } from "./ids";
import { DeterministicRNG } from "./rng";
import { BattleState, EffectState, UnitState, unitAlive } from "./state";
import { buildTurnOrder, nextTurnIndex } from "./turnOrder";
import { lookupHazardSource } from "../io/effectModelLoader";

export class ReductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReductionError";
  }
}

// ---------------------------------------------------------------------------
// Deep clone utility
// ---------------------------------------------------------------------------
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function appendEvent(
  events: Record<string, unknown>[],
  state: BattleState,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  state.eventSequence += 1;
  events.push({
    event_id: eventId(state.eventSequence),
    round: state.roundNumber,
    active_unit: state.turnOrder[state.turnIndex],
    type: eventType,
    payload,
  });
}

function assertActorTurn(state: BattleState, actorId: string): void {
  const activeId = state.turnOrder[state.turnIndex];
  if (activeId !== actorId) {
    throw new ReductionError(`actor ${actorId} is not active unit ${activeId}`);
  }
}

function advanceTurn(state: BattleState): void {
  const size = state.turnOrder.length;
  if (size === 0) return;
  const start = state.turnIndex;
  while (true) {
    const nxt = nextTurnIndex(state.turnIndex, size);
    if (nxt <= state.turnIndex) {
      state.roundNumber += 1;
    }
    state.turnIndex = nxt;
    const unit = state.units[state.turnOrder[state.turnIndex]];
    if (unitAlive(unit)) {
      unit.actionsRemaining = 3;
      unit.reactionAvailable = true;
      return;
    }
    if (state.turnIndex === start) return;
  }
}

function emitLifecycleEvents(
  events: Record<string, unknown>[],
  state: BattleState,
  lifecycleEvents: LifecycleEvent[],
): void {
  for (const [eventType, payload] of lifecycleEvents) {
    appendEvent(events, state, eventType, payload);
  }
}

function commandActionCost(command: RawCommand, defaultCost: number): number {
  const raw = command.action_cost ?? defaultCost;
  const cost = Number(raw);
  if (isNaN(cost) || cost <= 0) {
    throw new ReductionError(`action_cost must be positive, got ${raw}`);
  }
  return cost;
}

function spendActions(actor: UnitState, actionCost: number): void {
  if (actor.actionsRemaining < actionCost) {
    throw new ReductionError(
      `actor has insufficient actions remaining (${actor.actionsRemaining}) for cost ${actionCost}`,
    );
  }
  actor.actionsRemaining -= actionCost;
}

function unitSaveProfile(state: BattleState, unitId: string): SaveProfile {
  const unit = state.units[unitId];
  return { fortitude: unit.fortitude, reflex: unit.reflex, will: unit.will };
}

function saveModifierForType(unit: UnitState, saveType: string): number {
  if (saveType === "Fortitude") return unit.fortitude;
  if (saveType === "Reflex") return unit.reflex;
  if (saveType === "Will") return unit.will;
  return 0;
}

function newEffectId(state: BattleState): string {
  return `eff_${String(Object.keys(state.effects).length + 1).padStart(4, "0")}`;
}

function aliveUnitIds(state: BattleState): string[] {
  return Object.values(state.units)
    .filter((u) => unitAlive(u))
    .map((u) => u.unitId);
}

function enemyUnitIds(state: BattleState, actorId: string): string[] {
  const actor = state.units[actorId];
  return Object.values(state.units)
    .filter((u) => unitAlive(u) && u.unitId !== actorId && u.team !== actor.team)
    .map((u) => u.unitId);
}

function nearestEnemyUnitId(state: BattleState, actorId: string): string | null {
  const actor = state.units[actorId];
  const enemies = Object.values(state.units).filter(
    (u) => unitAlive(u) && u.unitId !== actorId && u.team !== actor.team,
  );
  if (enemies.length === 0) return null;
  const sorted = enemies.sort((a, b) => {
    const da = Math.abs(a.x - actor.x) + Math.abs(a.y - actor.y);
    const db = Math.abs(b.x - actor.x) + Math.abs(b.y - actor.y);
    if (da !== db) return da - db;
    return a.unitId.localeCompare(b.unitId);
  });
  return sorted[0].unitId;
}

function tilesFromFeet(feet: number): number {
  return Math.max(1, Math.floor((feet + 4) / 5));
}

function unitsWithinRadiusFeet(
  state: BattleState,
  centerX: number,
  centerY: number,
  radiusFeet: number,
  includeActorId?: string | null,
): string[] {
  const radiusTiles = tilesFromFeet(radiusFeet);
  const areaPoints = radiusPoints(centerX, centerY, radiusTiles);
  const areaSet = new Set(areaPoints.map(([x, y]) => `${x},${y}`));
  return Object.values(state.units)
    .filter((u) => {
      if (!unitAlive(u)) return false;
      if (includeActorId !== undefined && includeActorId !== null && u.unitId === includeActorId) return false;
      return areaSet.has(`${u.x},${u.y}`);
    })
    .map((u) => u.unitId);
}

function nearestOpenTile(
  state: BattleState,
  x: number,
  y: number,
): [number, number] | null {
  const tiles: Array<[number, number]> = [];
  for (let tx = 0; tx < state.battleMap.width; tx++) {
    for (let ty = 0; ty < state.battleMap.height; ty++) {
      tiles.push([tx, ty]);
    }
  }
  tiles.sort((a, b) => {
    const da = Math.abs(a[0] - x) + Math.abs(a[1] - y);
    const db = Math.abs(b[0] - x) + Math.abs(b[1] - y);
    if (da !== db) return da - db;
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[0] - b[0];
  });
  for (const [tx, ty] of tiles) {
    if (!inBounds(state, tx, ty)) continue;
    if (isBlocked(state, tx, ty)) continue;
    if (isOccupied(state, tx, ty)) continue;
    return [tx, ty];
  }
  return null;
}

function unitsInConeFeet(
  state: BattleState,
  actorId: string,
  facingX: number,
  facingY: number,
  sizeFeet: number,
): string[] {
  const actor = state.units[actorId];
  const area = new Set(
    conePoints(actor.x, actor.y, facingX, facingY, tilesFromFeet(sizeFeet)).map(
      ([x, y]) => `${x},${y}`,
    ),
  );
  return Object.values(state.units)
    .filter(
      (u) => unitAlive(u) && u.unitId !== actorId && area.has(`${u.x},${u.y}`),
    )
    .map((u) => u.unitId);
}

function chooseModelTargets(
  state: BattleState,
  actorId: string,
  effects: Array<Record<string, unknown>>,
  explicitTargetId: string | null | undefined,
  centerX: number | null | undefined,
  centerY: number | null | undefined,
): string[] {
  const actor = state.units[actorId];

  if (explicitTargetId) {
    const target = state.units[explicitTargetId];
    if (!target || !unitAlive(target)) return [];
    if (!hasTileLineOfEffect(state, actor.x, actor.y, target.x, target.y)) return [];
    return [explicitTargetId];
  }

  const areaEffects = effects.filter((e) => e["kind"] === "area");
  if (areaEffects.length > 0 && centerX != null && centerY != null) {
    const area = areaEffects[0];
    if (area["size_miles"] != null) {
      return aliveUnitIds(state).filter((uid) => uid !== actorId);
    }
    const sizeFeet = Number(area["size_feet"] ?? 5);
    const shape = String(area["shape"] ?? "within_radius");

    if (shape === "line") {
      const blocked = new Set(state.battleMap.blocked.map(([x, y]) => `${x},${y}`));
      const pts: Array<[number, number]> = [];
      for (const [idx, [x, y]] of linePoints(actor.x, actor.y, centerX, centerY).entries()) {
        if (idx === 0) continue;
        if (blocked.has(`${x},${y}`)) break;
        pts.push([x, y]);
      }
      const ptsSet = new Set(pts.map(([x, y]) => `${x},${y}`));
      return Object.values(state.units)
        .filter(
          (u) =>
            unitAlive(u) && u.unitId !== actorId && ptsSet.has(`${u.x},${u.y}`),
        )
        .map((u) => u.unitId);
    }

    if (shape === "cone") {
      const candidates = unitsInConeFeet(state, actorId, centerX, centerY, sizeFeet);
      return candidates.filter((uid) => {
        const t = state.units[uid];
        return hasTileLineOfEffect(state, actor.x, actor.y, t.x, t.y);
      });
    }

    if (["within_radius", "burst", "radius", "emanation"].includes(shape)) {
      const candidates = unitsWithinRadiusFeet(state, centerX, centerY, sizeFeet, actorId);
      return candidates.filter((uid) => {
        const t = state.units[uid];
        return hasTileLineOfEffect(state, centerX!, centerY!, t.x, t.y);
      });
    }

    // Default radius
    const candidates = unitsWithinRadiusFeet(state, centerX, centerY, sizeFeet, actorId);
    return candidates.filter((uid) => {
      const t = state.units[uid];
      return hasTileLineOfEffect(state, centerX!, centerY!, t.x, t.y);
    });
  }

  // Default: all alive non-actor units with LOE
  return aliveUnitIds(state).filter(
    (uid) =>
      uid !== actorId &&
      hasTileLineOfEffect(state, actor.x, actor.y, state.units[uid].x, state.units[uid].y),
  );
}

function durationToRounds(maximumDuration: unknown): number | null {
  if (typeof maximumDuration !== "object" || maximumDuration === null) return null;
  const d = maximumDuration as Record<string, unknown>;
  const amount = Number(d["amount"] ?? 0);
  const unit = String(d["unit"] ?? "");
  if (amount <= 0) return null;
  if (unit === "round") return amount;
  if (unit === "minute") return amount * 10;
  if (unit === "hour") return amount * 600;
  if (unit === "day") return amount * 14400;
  return null;
}

function inferPersistentAfflictionConditions(
  afflictionEvent: Record<string, unknown>,
): string[] {
  const raw = String(afflictionEvent["raw_fragment"] ?? "");
  const out = new Set<string>();
  const re = /Any\s+([a-zA-Z ]+?)\s+condition\s+[^.;]*\bpersists\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.add(m[1].trim().toLowerCase().replace(/ /g, "_"));
  }
  return [...out].sort();
}

function applyModeledEffectsToTarget(
  state: BattleState,
  rng: DeterministicRNG,
  actorId: string,
  targetId: string,
  effects: Array<Record<string, unknown>>,
  sourceLabel?: string,
): [Record<string, unknown>, LifecycleEvent[]] {
  const target = state.units[targetId];
  const saveEvent = effects.find((e) => e["kind"] === "save_check") ?? null;
  const damageEvent =
    effects.find((e) => e["kind"] === "damage" && e["formula"]) ?? null;
  const afflictionEvent = effects.find((e) => e["kind"] === "affliction") ?? null;
  const conditionEvents = effects.filter((e) => e["kind"] === "apply_condition");
  const deathEvents = effects.filter(
    (e) => e["kind"] === "instant_death" || e["kind"] === "special_lethality",
  );
  const transformEvents = effects.filter((e) => e["kind"] === "transform");
  const teleportEvents = effects.filter((e) => e["kind"] === "teleport");

  const lifecycleEvents: LifecycleEvent[] = [];
  let saveDetail: Record<string, unknown> | null = null;
  let damageDetail: Record<string, unknown> | null = null;
  let shouldApplySecondary = true;

  // --- Affliction path ---
  if (afflictionEvent) {
    const affSaveCfg =
      (afflictionEvent["save"] as Record<string, unknown>) ?? {};
    const dc = Number(
      affSaveCfg["dc"] ??
        (saveEvent ? saveEvent["dc"] : 0) ??
        0,
    );
    const saveType = String(
      affSaveCfg["save_type"] ??
        (saveEvent ? saveEvent["save_type"] : "Fortitude") ??
        "Fortitude",
    );
    let saveDegree: Degree = "failure";
    if (dc > 0) {
      const save = resolveSave(
        rng,
        saveType,
        unitSaveProfile(state, targetId),
        dc,
      );
      saveDegree = save.degree;
      saveDetail = {
        dc,
        save_type: saveType,
        mode: "affliction",
        die: save.die,
        modifier: save.modifier,
        total: save.total,
        degree: save.degree,
      };
    }

    const contracted = saveDegree === "failure" || saveDegree === "critical_failure";
    const afflictionDetail: Record<string, unknown> = {
      contracted,
      effect_id: null,
      initial_stage: null,
      maximum_duration_rounds: null,
    };

    if (contracted) {
      const stageValues = (
        (afflictionEvent["stages"] as Array<Record<string, unknown>>) ?? []
      )
        .filter((s) => s["stage"] != null)
        .map((s) => Number(s["stage"]));
      const maxStage = stageValues.length > 0 ? Math.max(...stageValues) : 1;
      let initialStage = 1;
      if (saveDegree === "critical_failure") {
        initialStage = Math.min(2, maxStage);
      }

      const durationRounds = durationToRounds(afflictionEvent["maximum_duration"]);
      const effect: EffectState = {
        effectId: newEffectId(state),
        kind: "affliction",
        sourceUnitId: actorId,
        targetUnitId: targetId,
        payload: {
          name: sourceLabel ?? "modeled_affliction",
          save: dc > 0 ? { dc, save_type: saveType } : deepClone(affSaveCfg),
          maximum_duration: deepClone(afflictionEvent["maximum_duration"]),
          stages: deepClone(afflictionEvent["stages"] ?? []),
          current_stage: initialStage,
          persistent_conditions: inferPersistentAfflictionConditions(afflictionEvent),
        },
        durationRounds,
        tickTiming: "turn_end",
      };
      state.effects[effect.effectId] = effect;
      lifecycleEvents.push(...onApply(state, effect, rng));

      afflictionDetail["effect_id"] = effect.effectId;
      afflictionDetail["initial_stage"] = initialStage;
      afflictionDetail["maximum_duration_rounds"] = durationRounds;
    }

    return [
      {
        actor: actorId,
        target: targetId,
        save: saveDetail,
        damage: null,
        applied_conditions: [],
        special_flags: [],
        affliction: afflictionDetail,
        target_hp: target.hp,
      },
      lifecycleEvents,
    ];
  }

  // --- Save + optional damage path ---
  if (saveEvent) {
    const save = resolveSave(
      rng,
      String(saveEvent["save_type"]),
      unitSaveProfile(state, targetId),
      Number(saveEvent["dc"]),
    );
    const saveMode = String(saveEvent["mode"] ?? "standard");
    saveDetail = {
      dc: Number(saveEvent["dc"]),
      save_type: String(saveEvent["save_type"]),
      mode: saveMode,
      die: save.die,
      modifier: save.modifier,
      total: save.total,
      degree: save.degree,
    };
    shouldApplySecondary =
      save.degree === "failure" || save.degree === "critical_failure";

    if (damageEvent) {
      const baseRoll = rollDamage(rng, String(damageEvent["formula"]));
      const bypass = ((damageEvent["bypass"] as string[]) ?? []).map((x) =>
        String(x).toLowerCase(),
      );
      let multiplier = 1.0;
      if (saveMode === "basic") {
        multiplier = basicSaveMultiplier(save.degree);
      } else if (saveMode === "negates") {
        multiplier =
          save.degree === "success" || save.degree === "critical_success"
            ? 0
            : 1;
      }
      const rawTotal = Math.floor(baseRoll.total * multiplier);
      const adjustment = applyDamageModifiers({
        rawTotal,
        damageType: (String(damageEvent["damage_type"] ?? "") || null) as string | null,
        resistances: target.resistances,
        weaknesses: target.weaknesses,
        immunities: target.immunities,
        bypass,
      });
      const appliedDamage = applyDamageToPool({
        hp: target.hp,
        tempHp: target.tempHp,
        damageTotal: adjustment.appliedTotal,
      });
      target.hp = appliedDamage.newHp;
      target.tempHp = appliedDamage.newTempHp;
      if (target.tempHp === 0) {
        target.tempHpSource = null;
        target.tempHpOwnerEffectId = null;
      }
      damageDetail = {
        formula: damageEvent["formula"],
        damage_type: damageEvent["damage_type"] ?? null,
        rolled_total: baseRoll.total,
        rolls: baseRoll.rolls,
        flat_modifier: baseRoll.flatModifier,
        multiplier,
        raw_total: adjustment.rawTotal,
        immune: adjustment.immune,
        resistance_total: adjustment.resistanceTotal,
        weakness_total: adjustment.weaknessTotal,
        applied_total: adjustment.appliedTotal,
      };
      if (bypass.length > 0) damageDetail["bypass"] = bypass;
      if (appliedDamage.absorbedByTempHp > 0)
        damageDetail["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;
    }
  } else if (damageEvent) {
    // Damage without save
    const baseRoll = rollDamage(rng, String(damageEvent["formula"]));
    const bypass = ((damageEvent["bypass"] as string[]) ?? []).map((x) =>
      String(x).toLowerCase(),
    );
    const adjustment = applyDamageModifiers({
      rawTotal: baseRoll.total,
      damageType: (String(damageEvent["damage_type"] ?? "") || null) as string | null,
      resistances: target.resistances,
      weaknesses: target.weaknesses,
      immunities: target.immunities,
      bypass,
    });
    const appliedDamage = applyDamageToPool({
      hp: target.hp,
      tempHp: target.tempHp,
      damageTotal: adjustment.appliedTotal,
    });
    target.hp = appliedDamage.newHp;
    target.tempHp = appliedDamage.newTempHp;
    if (target.tempHp === 0) {
      target.tempHpSource = null;
      target.tempHpOwnerEffectId = null;
    }
    damageDetail = {
      formula: damageEvent["formula"],
      damage_type: damageEvent["damage_type"] ?? null,
      rolled_total: baseRoll.total,
      rolls: baseRoll.rolls,
      flat_modifier: baseRoll.flatModifier,
      multiplier: 1.0,
      raw_total: adjustment.rawTotal,
      immune: adjustment.immune,
      resistance_total: adjustment.resistanceTotal,
      weakness_total: adjustment.weaknessTotal,
      applied_total: adjustment.appliedTotal,
    };
    if (bypass.length > 0) damageDetail["bypass"] = bypass;
    if (appliedDamage.absorbedByTempHp > 0)
      damageDetail["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;
  }

  // --- Conditions ---
  const appliedConditions: Record<string, unknown>[] = [];
  const skippedConditions: Record<string, unknown>[] = [];
  if (shouldApplySecondary) {
    for (const cond of conditionEvents) {
      const name = normalizeConditionName(String(cond["condition"] ?? ""));
      const value = Number(cond["value"] ?? 1);
      if (name) {
        if (conditionIsImmune(name, target.conditionImmunities)) {
          skippedConditions.push({ name, value, reason: "condition_immune" });
        } else {
          target.conditions = applyCondition(target.conditions, name, value);
          appliedConditions.push({ name, value });
        }
      }
    }
  }

  // --- Death events ---
  const specialFlags: string[] = [];
  if (deathEvents.length > 0 && shouldApplySecondary) {
    target.hp = 0;
    target.conditions = applyCondition(target.conditions, "unconscious", 1);
    for (const evt of deathEvents) {
      specialFlags.push(String(evt["kind"]));
    }
  }
  if (target.hp === 0) {
    target.conditions = applyCondition(target.conditions, "unconscious", 1);
  }

  for (const evt of transformEvents) {
    specialFlags.push(`transform:${evt["transform_type"] ?? "unknown"}`);
  }
  for (const evt of teleportEvents) {
    specialFlags.push(`teleport:${evt["teleport_type"] ?? "unknown"}`);
  }

  return [
    {
      actor: actorId,
      target: targetId,
      save: saveDetail,
      damage: damageDetail,
      applied_conditions: appliedConditions,
      skipped_conditions: skippedConditions,
      special_flags: specialFlags,
      affliction: null,
      target_hp: target.hp,
    },
    lifecycleEvents,
  ];
}

// ---------------------------------------------------------------------------
// Main reducer
// ---------------------------------------------------------------------------
export function applyCommand(
  state: BattleState,
  command: RawCommand,
  rng: DeterministicRNG,
): [BattleState, Record<string, unknown>[]] {
  const nextState = deepClone(state);
  const events: Record<string, unknown>[] = [];

  const commandType = command.type;
  const actorId = command.actor ?? "";
  assertActorTurn(nextState, actorId);

  const actor = nextState.units[actorId];
  if (!actor || !unitAlive(actor)) {
    throw new ReductionError(`actor ${actorId} is not alive`);
  }

  // =========================================================================
  // MOVE
  // =========================================================================
  if (commandType === "move") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const x = Number(command.x);
    const y = Number(command.y);
    if (!canStepTo(nextState, actor, x, y)) {
      throw new ReductionError(`illegal move target (${x}, ${y})`);
    }
    const old: [number, number] = [actor.x, actor.y];
    actor.x = x;
    actor.y = y;
    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "move", {
      actor: actorId,
      from: old,
      to: [x, y],
      actions_remaining: actor.actionsRemaining,
    });
    return [nextState, events];
  }

  // =========================================================================
  // STRIKE
  // =========================================================================
  if (commandType === "strike") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);
    if (!hasLineOfSight(nextState, actor, target)) {
      throw new ReductionError(`no line of sight from ${actorId} to ${targetId}`);
    }

    const coverGrade = coverGradeForUnits(nextState, actor, target);
    const coverBonus = coverAcBonusForUnits(nextState, actor, target);
    const effectiveAc = target.ac + coverBonus;
    const check = resolveCheck(rng, actor.attackMod, effectiveAc);

    let forecast: Record<string, unknown> | null = null;
    if (command.emit_forecast) {
      forecast = strikeForecast(actor.attackMod, effectiveAc, actor.damage);
    }

    let multiplier = 0;
    if (check.degree === "critical_success") multiplier = 2;
    else if (check.degree === "success") multiplier = 1;

    let damageTotal = 0;
    let damageDetail: Record<string, unknown> | null = null;
    if (multiplier > 0) {
      const dmg = rollDamage(rng, actor.damage, multiplier);
      const adjustment = applyDamageModifiers({
        rawTotal: dmg.total,
        damageType: actor.attackDamageType,
        resistances: target.resistances,
        weaknesses: target.weaknesses,
        immunities: target.immunities,
        bypass: actor.attackDamageBypass,
      });
      damageTotal = adjustment.appliedTotal;
      damageDetail = {
        formula: actor.damage,
        damage_type: actor.attackDamageType,
        rolls: dmg.rolls,
        flat_modifier: dmg.flatModifier,
        multiplier,
        raw_total: adjustment.rawTotal,
        immune: adjustment.immune,
        resistance_total: adjustment.resistanceTotal,
        weakness_total: adjustment.weaknessTotal,
        total: damageTotal,
      };
      if (actor.attackDamageBypass.length > 0) {
        damageDetail["bypass"] = [...actor.attackDamageBypass];
      }
      const appliedDamage = applyDamageToPool({
        hp: target.hp,
        tempHp: target.tempHp,
        damageTotal,
      });
      target.hp = appliedDamage.newHp;
      target.tempHp = appliedDamage.newTempHp;
      if (target.tempHp === 0) {
        target.tempHpSource = null;
        target.tempHpOwnerEffectId = null;
      }
      if (appliedDamage.absorbedByTempHp > 0) {
        damageDetail["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;
      }
      if (target.hp === 0) {
        target.conditions = applyCondition(target.conditions, "unconscious", 1);
      }
    }

    actor.actionsRemaining -= 1;
    const strikePayload: Record<string, unknown> = {
      actor: actorId,
      target: targetId,
      degree: check.degree,
      roll: {
        die: check.die,
        modifier: check.modifier,
        total: check.total,
        base_dc: target.ac,
        cover_grade: coverGrade,
        cover_bonus: coverBonus,
        dc: check.dc,
      },
      damage: damageDetail,
      target_hp: target.hp,
      actions_remaining: actor.actionsRemaining,
    };
    if (forecast) strikePayload["forecast"] = forecast;
    appendEvent(events, nextState, "strike", strikePayload);
    return [nextState, events];
  }

  // =========================================================================
  // END TURN
  // =========================================================================
  if (commandType === "end_turn") {
    appendEvent(events, nextState, "end_turn", {
      actor: actorId,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, processTiming(nextState, rng, "turn_end"));
    advanceTurn(nextState);
    appendEvent(events, nextState, "turn_start", {
      active_unit: nextState.turnOrder[nextState.turnIndex],
      round: nextState.roundNumber,
    });
    emitLifecycleEvents(events, nextState, processTiming(nextState, rng, "turn_start"));
    return [nextState, events];
  }

  // =========================================================================
  // CAST SPELL
  // =========================================================================
  if (commandType === "cast_spell") {
    const spellId = String(command.spell_id ?? "");
    if (!spellId) throw new ReductionError("cast_spell requires spell_id");
    const actionCost = commandActionCost(command, 2);
    spendActions(actor, actionCost);

    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    const dc = Number(command.dc);
    const saveType = command.save_type ?? "Reflex";
    const damageFormula = String(command.damage ?? "");
    const damageType = (String(command.damage_type ?? "") || null) as string | null;
    const damageBypass = (command.damage_bypass ?? []).map((x: string) =>
      String(x).toLowerCase(),
    );
    const mode = command.mode ?? "basic";
    if (mode !== "basic") throw new ReductionError(`unsupported cast_spell mode: ${mode}`);

    const save = resolveSave(rng, saveType, unitSaveProfile(nextState, targetId), dc);
    const multiplier = basicSaveMultiplier(save.degree);
    const damageRoll = rollDamage(rng, damageFormula);
    const rawTotal = Math.floor(damageRoll.total * multiplier);
    const adjustment = applyDamageModifiers({
      rawTotal,
      damageType,
      resistances: target.resistances,
      weaknesses: target.weaknesses,
      immunities: target.immunities,
      bypass: damageBypass,
    });
    const damageTotal = adjustment.appliedTotal;
    const appliedDamage = applyDamageToPool({
      hp: target.hp,
      tempHp: target.tempHp,
      damageTotal,
    });
    target.hp = appliedDamage.newHp;
    target.tempHp = appliedDamage.newTempHp;
    if (target.tempHp === 0) {
      target.tempHpSource = null;
      target.tempHpOwnerEffectId = null;
    }
    if (target.hp === 0) {
      target.conditions = applyCondition(target.conditions, "unconscious", 1);
    }

    const damagePayload: Record<string, unknown> = {
      formula: damageFormula,
      damage_type: damageType,
      rolled_total: damageRoll.total,
      rolls: damageRoll.rolls,
      flat_modifier: damageRoll.flatModifier,
      multiplier,
      raw_total: adjustment.rawTotal,
      immune: adjustment.immune,
      resistance_total: adjustment.resistanceTotal,
      weakness_total: adjustment.weaknessTotal,
      applied_total: damageTotal,
    };
    if (damageBypass.length > 0) damagePayload["bypass"] = damageBypass;
    if (appliedDamage.absorbedByTempHp > 0)
      damagePayload["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;

    const forecast = castSpellForecast(
      saveModifierForType(target, saveType),
      dc,
      damageFormula,
      mode,
    );

    appendEvent(events, nextState, "cast_spell", {
      actor: actorId,
      spell_id: spellId,
      target: targetId,
      action_cost: actionCost,
      save_type: saveType,
      mode,
      roll: {
        die: save.die,
        modifier: save.modifier,
        total: save.total,
        dc: save.dc,
        degree: save.degree,
      },
      forecast,
      damage: damagePayload,
      target_hp: target.hp,
      actions_remaining: actor.actionsRemaining,
    });
    return [nextState, events];
  }

  // =========================================================================
  // SAVE DAMAGE
  // =========================================================================
  if (commandType === "save_damage") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    const dc = Number(command.dc);
    const saveType = command.save_type ?? "Reflex";
    const damageFormula = String(command.damage ?? "");
    const damageType = (String(command.damage_type ?? "") || null) as string | null;
    const damageBypass = (command.damage_bypass ?? []).map((x: string) =>
      String(x).toLowerCase(),
    );
    const mode = command.mode ?? "basic";
    if (mode !== "basic") throw new ReductionError(`unsupported save_damage mode: ${mode}`);

    const save = resolveSave(rng, saveType, unitSaveProfile(nextState, targetId), dc);
    const multiplier = basicSaveMultiplier(save.degree);
    const damageRoll = rollDamage(rng, damageFormula);
    const rawTotal = Math.floor(damageRoll.total * multiplier);
    const adjustment = applyDamageModifiers({
      rawTotal,
      damageType,
      resistances: target.resistances,
      weaknesses: target.weaknesses,
      immunities: target.immunities,
      bypass: damageBypass,
    });
    const damageTotal = adjustment.appliedTotal;
    const appliedDamage = applyDamageToPool({
      hp: target.hp,
      tempHp: target.tempHp,
      damageTotal,
    });
    target.hp = appliedDamage.newHp;
    target.tempHp = appliedDamage.newTempHp;
    if (target.tempHp === 0) {
      target.tempHpSource = null;
      target.tempHpOwnerEffectId = null;
    }
    if (target.hp === 0) {
      target.conditions = applyCondition(target.conditions, "unconscious", 1);
    }

    const damagePayload: Record<string, unknown> = {
      formula: damageFormula,
      damage_type: damageType,
      rolled_total: damageRoll.total,
      rolls: damageRoll.rolls,
      flat_modifier: damageRoll.flatModifier,
      multiplier,
      raw_total: adjustment.rawTotal,
      immune: adjustment.immune,
      resistance_total: adjustment.resistanceTotal,
      weakness_total: adjustment.weaknessTotal,
      applied_total: damageTotal,
    };
    if (damageBypass.length > 0) damagePayload["bypass"] = damageBypass;
    if (appliedDamage.absorbedByTempHp > 0)
      damagePayload["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;

    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "save_damage", {
      actor: actorId,
      target: targetId,
      save_type: saveType,
      mode,
      roll: {
        die: save.die,
        modifier: save.modifier,
        total: save.total,
        dc: save.dc,
        degree: save.degree,
      },
      damage: damagePayload,
      target_hp: target.hp,
      actions_remaining: actor.actionsRemaining,
    });
    return [nextState, events];
  }

  // =========================================================================
  // AREA SAVE DAMAGE
  // =========================================================================
  if (commandType === "area_save_damage") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const centerX = Number(command.center_x);
    const centerY = Number(command.center_y);
    const radiusFeet = Number(command.radius_feet);
    const dc = Number(command.dc);
    const saveType = String(command.save_type ?? "Reflex");
    const damageFormula = String(command.damage ?? "");
    const damageType = (String(command.damage_type ?? "") || null) as string | null;
    const damageBypass = (command.damage_bypass ?? []).map((x: string) =>
      String(x).toLowerCase(),
    );
    const mode = command.mode ?? "basic";
    if (mode !== "basic")
      throw new ReductionError(`unsupported area_save_damage mode: ${mode}`);

    const includeActor = Boolean(command.include_actor);
    const excluded = includeActor ? null : actorId;
    let targets = unitsWithinRadiusFeet(nextState, centerX, centerY, radiusFeet, excluded);
    targets = targets.filter((uid) => {
      const t = nextState.units[uid];
      return hasTileLineOfEffect(nextState, centerX, centerY, t.x, t.y);
    });

    const resolutions: Record<string, unknown>[] = [];
    for (const targetId of targets) {
      const save = resolveSave(
        rng,
        saveType,
        unitSaveProfile(nextState, targetId),
        dc,
      );
      const multiplier = basicSaveMultiplier(save.degree);
      const roll = rollDamage(rng, damageFormula);
      const rawTotal = Math.floor(roll.total * multiplier);
      const tgt = nextState.units[targetId];
      const adjustment = applyDamageModifiers({
        rawTotal,
        damageType,
        resistances: tgt.resistances,
        weaknesses: tgt.weaknesses,
        immunities: tgt.immunities,
        bypass: damageBypass,
      });
      const applied = adjustment.appliedTotal;
      const appliedDamage = applyDamageToPool({
        hp: tgt.hp,
        tempHp: tgt.tempHp,
        damageTotal: applied,
      });
      tgt.hp = appliedDamage.newHp;
      tgt.tempHp = appliedDamage.newTempHp;
      if (tgt.tempHp === 0) {
        tgt.tempHpSource = null;
        tgt.tempHpOwnerEffectId = null;
      }
      if (tgt.hp === 0) {
        tgt.conditions = applyCondition(tgt.conditions, "unconscious", 1);
      }
      const damagePayload: Record<string, unknown> = {
        formula: damageFormula,
        damage_type: damageType,
        rolled_total: roll.total,
        rolls: roll.rolls,
        flat_modifier: roll.flatModifier,
        multiplier,
        raw_total: adjustment.rawTotal,
        immune: adjustment.immune,
        resistance_total: adjustment.resistanceTotal,
        weakness_total: adjustment.weaknessTotal,
        applied_total: applied,
      };
      if (damageBypass.length > 0) damagePayload["bypass"] = damageBypass;
      if (appliedDamage.absorbedByTempHp > 0)
        damagePayload["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;
      resolutions.push({
        target: targetId,
        save: {
          dc,
          save_type: saveType,
          mode,
          die: save.die,
          modifier: save.modifier,
          total: save.total,
          degree: save.degree,
        },
        damage: damagePayload,
        target_hp: tgt.hp,
      });
    }

    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "area_save_damage", {
      actor: actorId,
      center: [centerX, centerY],
      radius_feet: radiusFeet,
      save_type: saveType,
      dc,
      mode,
      damage_formula: damageFormula,
      targets,
      resolutions,
      actions_remaining: actor.actionsRemaining,
    });
    return [nextState, events];
  }

  // =========================================================================
  // SET FLAG
  // =========================================================================
  if (commandType === "set_flag") {
    const flag = String(command.flag ?? "");
    const value = command.value !== false;
    nextState.flags[flag] = value;
    appendEvent(events, nextState, "set_flag", {
      actor: actorId,
      flag,
      value,
    });
    return [nextState, events];
  }

  // =========================================================================
  // SPAWN UNIT
  // =========================================================================
  if (commandType === "spawn_unit") {
    const unitRaw = (command.unit as Record<string, unknown>) ?? {};
    const unitId = String(unitRaw["id"] ?? "");
    if (!unitId) throw new ReductionError("spawn_unit requires unit.id");
    if (nextState.units[unitId]) {
      throw new ReductionError(`cannot spawn duplicate unit id: ${unitId}`);
    }

    const posRaw = unitRaw["position"] as unknown[];
    if (!Array.isArray(posRaw) || posRaw.length !== 2) {
      throw new ReductionError("spawn_unit unit.position must be [x, y]");
    }
    let spawnX = Number(posRaw[0]);
    let spawnY = Number(posRaw[1]);
    const policy = String(command.placement_policy ?? "exact");

    if (policy === "nearest_open") {
      const placement = nearestOpenTile(nextState, spawnX, spawnY);
      if (!placement) {
        throw new ReductionError("spawn_unit found no open tile for nearest_open placement");
      }
      [spawnX, spawnY] = placement;
    } else if (policy === "exact") {
      if (!inBounds(nextState, spawnX, spawnY)) {
        throw new ReductionError(`spawn position out of bounds: (${spawnX}, ${spawnY})`);
      }
      if (isBlocked(nextState, spawnX, spawnY)) {
        throw new ReductionError(`spawn position blocked: (${spawnX}, ${spawnY})`);
      }
      if (isOccupied(nextState, spawnX, spawnY)) {
        throw new ReductionError(`spawn position occupied: (${spawnX}, ${spawnY})`);
      }
    } else {
      throw new ReductionError(`unsupported spawn placement policy: ${policy}`);
    }

    const hp = Number(unitRaw["hp"] ?? 0);
    if (hp <= 0) throw new ReductionError("spawn_unit unit.hp must be > 0");
    const tempHp = Number(unitRaw["temp_hp"] ?? 0);
    if (tempHp < 0) throw new ReductionError("spawn_unit unit.temp_hp must be >= 0");

    const rawConditions = (unitRaw["conditions"] ?? {}) as Record<string, unknown>;
    const rawResistances = (unitRaw["resistances"] ?? {}) as Record<string, unknown>;
    const rawWeaknesses = (unitRaw["weaknesses"] ?? {}) as Record<string, unknown>;

    const spawned: UnitState = {
      unitId,
      team: String(unitRaw["team"] ?? ""),
      hp,
      maxHp: Number(unitRaw["max_hp"] ?? hp),
      x: spawnX,
      y: spawnY,
      initiative: Number(unitRaw["initiative"] ?? 0),
      attackMod: Number(unitRaw["attack_mod"] ?? 0),
      ac: Number(unitRaw["ac"] ?? 10),
      damage: String(unitRaw["damage"] ?? "1d1"),
      tempHp,
      tempHpSource: tempHp > 0 ? `spawn:${unitId}` : null,
      tempHpOwnerEffectId: null,
      attackDamageType: String(unitRaw["attack_damage_type"] ?? "physical").toLowerCase(),
      attackDamageBypass: ((unitRaw["attack_damage_bypass"] as string[]) ?? []).map(
        (x) => String(x).toLowerCase(),
      ),
      fortitude: Number(unitRaw["fortitude"] ?? 0),
      reflex: Number(unitRaw["reflex"] ?? 0),
      will: Number(unitRaw["will"] ?? 0),
      actionsRemaining: 3,
      reactionAvailable: true,
      conditions: Object.fromEntries(
        Object.entries(rawConditions).map(([k, v]) => [String(k), Number(v)]),
      ),
      conditionImmunities: ((unitRaw["condition_immunities"] as string[]) ?? []).map(
        (x) => String(x).toLowerCase().replace(/ /g, "_"),
      ),
      resistances: Object.fromEntries(
        Object.entries(rawResistances).map(([k, v]) => [String(k).toLowerCase(), Number(v)]),
      ),
      weaknesses: Object.fromEntries(
        Object.entries(rawWeaknesses).map(([k, v]) => [String(k).toLowerCase(), Number(v)]),
      ),
      immunities: ((unitRaw["immunities"] as string[]) ?? []).map((x) =>
        String(x).toLowerCase(),
      ),
    };
    if (!spawned.team) throw new ReductionError("spawn_unit unit.team is required");

    const activeUnitIdSaved = nextState.turnOrder[nextState.turnIndex];
    nextState.units[unitId] = spawned;
    nextState.turnOrder = buildTurnOrder(nextState.units);
    nextState.turnIndex = nextState.turnOrder.indexOf(activeUnitIdSaved);

    const spendAction = Boolean(command.spend_action);
    if (spendAction) {
      if (actor.actionsRemaining <= 0) {
        throw new ReductionError("actor has no actions remaining");
      }
      actor.actionsRemaining -= 1;
    }

    appendEvent(events, nextState, "spawn_unit", {
      actor: actorId,
      unit_id: unitId,
      team: spawned.team,
      position: [spawned.x, spawned.y],
      placement_policy: policy,
      spend_action: spendAction,
      actions_remaining: actor.actionsRemaining,
    });
    return [nextState, events];
  }

  // =========================================================================
  // RUN HAZARD ROUTINE
  // =========================================================================
  if (commandType === "run_hazard_routine") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const hazardId = String(command.hazard_id ?? "");
    const sourceName = String(command.source_name ?? "");
    const sourceType = String(command.source_type ?? "trigger_action");
    const modelPath = command.model_path ?? undefined;
    let policy = String(command.target_policy ?? "nearest_enemy");

    let centerX: number | null = command.center_x ?? null;
    let centerY: number | null = command.center_y ?? null;
    let explicitTarget: string | null | undefined = command.target ?? null;

    if (policy === "nearest_enemy") {
      explicitTarget = nearestEnemyUnitId(nextState, actorId);
    } else if (policy === "nearest_enemy_area_center") {
      const nearestId = nearestEnemyUnitId(nextState, actorId);
      explicitTarget = null;
      if (nearestId) {
        const nearest = nextState.units[nearestId];
        centerX = nearest.x;
        centerY = nearest.y;
      }
    } else if (policy === "explicit") {
      // use as-is
    } else if (policy === "all_enemies") {
      explicitTarget = null;
    } else if (policy === "as_configured") {
      // use as-is
    } else {
      throw new ReductionError(`unsupported target policy: ${policy}`);
    }

    let source: Record<string, unknown>;
    try {
      source = lookupHazardSource(hazardId, sourceName, sourceType, modelPath);
    } catch (e) {
      throw new ReductionError(String(e));
    }

    const effects = (source["effects"] as Array<Record<string, unknown>>) ?? [];
    let targetIds = chooseModelTargets(
      nextState,
      actorId,
      effects,
      explicitTarget,
      centerX,
      centerY,
    );

    if (policy === "all_enemies") {
      const actorTeam = nextState.units[actorId].team;
      targetIds = targetIds.filter((uid) => nextState.units[uid].team !== actorTeam);
    }

    const perTarget: Record<string, unknown>[] = [];
    const lifecycleEvents: LifecycleEvent[] = [];
    for (const targetId of targetIds) {
      if (!nextState.units[targetId] || !unitAlive(nextState.units[targetId])) continue;
      const [result, tEvents] = applyModeledEffectsToTarget(
        nextState,
        rng,
        actorId,
        targetId,
        effects,
        `${hazardId}:${sourceName}`,
      );
      perTarget.push(result);
      lifecycleEvents.push(...tEvents);
    }

    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "run_hazard_routine", {
      actor: actorId,
      hazard_id: hazardId,
      source_type: sourceType,
      source_name: sourceName,
      target_policy: policy,
      center:
        centerX !== null && centerY !== null ? [centerX, centerY] : null,
      explicit_target: explicitTarget,
      target_ids: targetIds,
      effect_kinds: [...new Set(effects.map((e) => String(e["kind"] ?? "")))].filter(Boolean).sort(),
      results: perTarget,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, lifecycleEvents);
    return [nextState, events];
  }

  // =========================================================================
  // TRIGGER HAZARD SOURCE
  // =========================================================================
  if (commandType === "trigger_hazard_source") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const hazardId = String(command.hazard_id ?? "");
    const sourceName = String(command.source_name ?? "");
    const sourceType = String(command.source_type ?? "trigger_action");
    const modelPath = command.model_path ?? undefined;
    const centerX: number | null = command.center_x ?? null;
    const centerY: number | null = command.center_y ?? null;
    const explicitTarget = command.target ?? null;

    let source: Record<string, unknown>;
    try {
      source = lookupHazardSource(hazardId, sourceName, sourceType, modelPath);
    } catch (e) {
      throw new ReductionError(String(e));
    }

    const effects = (source["effects"] as Array<Record<string, unknown>>) ?? [];
    const targetIds = chooseModelTargets(
      nextState,
      actorId,
      effects,
      explicitTarget,
      centerX,
      centerY,
    );

    const perTarget: Record<string, unknown>[] = [];
    const lifecycleEvents: LifecycleEvent[] = [];
    for (const targetId of targetIds) {
      if (!nextState.units[targetId] || !unitAlive(nextState.units[targetId])) continue;
      const [result, tEvents] = applyModeledEffectsToTarget(
        nextState,
        rng,
        actorId,
        targetId,
        effects,
        `${hazardId}:${sourceName}`,
      );
      perTarget.push(result);
      lifecycleEvents.push(...tEvents);
    }

    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "trigger_hazard_source", {
      actor: actorId,
      hazard_id: hazardId,
      source_type: sourceType,
      source_name: sourceName,
      center:
        centerX !== null && centerY !== null ? [centerX, centerY] : null,
      explicit_target: explicitTarget,
      target_ids: targetIds,
      effect_kinds: [...new Set(effects.map((e) => String(e["kind"] ?? "")))].filter(Boolean).sort(),
      results: perTarget,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, lifecycleEvents);
    return [nextState, events];
  }

  // =========================================================================
  // USE FEAT
  // =========================================================================
  if (commandType === "use_feat") {
    const featId = String(command.feat_id ?? "");
    if (!featId) throw new ReductionError("use_feat requires feat_id");
    const actionCost = commandActionCost(command, 1);
    spendActions(actor, actionCost);

    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    const effect: EffectState = {
      effectId: newEffectId(nextState),
      kind: String(command.effect_kind ?? ""),
      sourceUnitId: actorId,
      targetUnitId: targetId,
      payload: { ...((command.payload as Record<string, unknown>) ?? {}) },
      durationRounds: command.duration_rounds ?? null,
      tickTiming:
        (command.tick_timing as "turn_start" | "turn_end" | null) ?? null,
    };
    nextState.effects[effect.effectId] = effect;

    appendEvent(events, nextState, "use_feat", {
      actor: actorId,
      feat_id: featId,
      target: targetId,
      effect_id: effect.effectId,
      kind: effect.kind,
      duration_rounds: effect.durationRounds,
      tick_timing: effect.tickTiming,
      action_cost: actionCost,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, onApply(nextState, effect, rng));
    return [nextState, events];
  }

  // =========================================================================
  // USE ITEM
  // =========================================================================
  if (commandType === "use_item") {
    const itemId = String(command.item_id ?? "");
    if (!itemId) throw new ReductionError("use_item requires item_id");
    const actionCost = commandActionCost(command, 1);
    spendActions(actor, actionCost);

    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    const effect: EffectState = {
      effectId: newEffectId(nextState),
      kind: String(command.effect_kind ?? ""),
      sourceUnitId: actorId,
      targetUnitId: targetId,
      payload: { ...((command.payload as Record<string, unknown>) ?? {}) },
      durationRounds: command.duration_rounds ?? null,
      tickTiming:
        (command.tick_timing as "turn_start" | "turn_end" | null) ?? null,
    };
    nextState.effects[effect.effectId] = effect;

    appendEvent(events, nextState, "use_item", {
      actor: actorId,
      item_id: itemId,
      target: targetId,
      effect_id: effect.effectId,
      kind: effect.kind,
      duration_rounds: effect.durationRounds,
      tick_timing: effect.tickTiming,
      action_cost: actionCost,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, onApply(nextState, effect, rng));
    return [nextState, events];
  }

  // =========================================================================
  // INTERACT
  // =========================================================================
  if (commandType === "interact") {
    const interactId = String(command.interact_id ?? "");
    if (!interactId) throw new ReductionError("interact requires interact_id");
    const actionCost = commandActionCost(command, 1);
    spendActions(actor, actionCost);

    const targetId = String(command.target ?? actorId);
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    let flagUpdate: Record<string, unknown> | null = null;
    if (command.flag !== undefined) {
      const flag = String(command.flag ?? "");
      if (!flag) throw new ReductionError("interact flag cannot be empty");
      const flagValue = command.value !== false;
      nextState.flags[flag] = flagValue;
      flagUpdate = { flag, value: flagValue };
    }

    let effectId: string | null = null;
    const lifecycleEvents: LifecycleEvent[] = [];
    const effectKind = command.effect_kind ?? null;
    if (effectKind !== null && effectKind !== undefined) {
      const effect: EffectState = {
        effectId: newEffectId(nextState),
        kind: String(effectKind),
        sourceUnitId: actorId,
        targetUnitId: targetId,
        payload: { ...((command.payload as Record<string, unknown>) ?? {}) },
        durationRounds: command.duration_rounds ?? null,
        tickTiming:
          (command.tick_timing as "turn_start" | "turn_end" | null) ?? null,
      };
      nextState.effects[effect.effectId] = effect;
      effectId = effect.effectId;
      lifecycleEvents.push(...onApply(nextState, effect, rng));
    }

    const payload: Record<string, unknown> = {
      actor: actorId,
      interact_id: interactId,
      target: targetId,
      effect_id: effectId,
      effect_kind: effectKind,
      action_cost: actionCost,
      actions_remaining: actor.actionsRemaining,
    };
    if (flagUpdate) payload["flag_update"] = flagUpdate;
    appendEvent(events, nextState, "interact", payload);
    emitLifecycleEvents(events, nextState, lifecycleEvents);
    return [nextState, events];
  }

  // =========================================================================
  // APPLY EFFECT
  // =========================================================================
  if (commandType === "apply_effect") {
    if (actor.actionsRemaining <= 0) {
      throw new ReductionError("actor has no actions remaining");
    }
    const targetId = command.target ?? "";
    const target = nextState.units[targetId];
    if (!target) throw new ReductionError(`unknown target ${targetId}`);
    if (!unitAlive(target)) throw new ReductionError(`target ${targetId} is not alive`);

    const effect: EffectState = {
      effectId: newEffectId(nextState),
      kind: String(command.effect_kind ?? ""),
      sourceUnitId: actorId,
      targetUnitId: targetId,
      payload: { ...((command.payload as Record<string, unknown>) ?? {}) },
      durationRounds: command.duration_rounds ?? null,
      tickTiming:
        (command.tick_timing as "turn_start" | "turn_end" | null) ?? null,
    };
    nextState.effects[effect.effectId] = effect;

    actor.actionsRemaining -= 1;
    appendEvent(events, nextState, "apply_effect_command", {
      actor: actorId,
      target: targetId,
      effect_id: effect.effectId,
      kind: effect.kind,
      duration_rounds: effect.durationRounds,
      tick_timing: effect.tickTiming,
      actions_remaining: actor.actionsRemaining,
    });
    emitLifecycleEvents(events, nextState, onApply(nextState, effect, rng));
    return [nextState, events];
  }

  throw new ReductionError(`unsupported command type: ${commandType}`);
}
