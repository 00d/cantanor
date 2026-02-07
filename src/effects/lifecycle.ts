/**
 * Effect lifecycle hooks for apply/tick/expire phases.
 * Mirrors engine/effects/lifecycle.py
 *
 * Pathfinder 2e ORC affliction rules: staged disease/poison with save
 * progression. Persistent damage with recovery checks. Temp HP stacking policies.
 */

import { DeterministicRNG } from "../engine/rng";
import { BattleState, EffectState, unitAlive } from "../engine/state";
import { resolveCheck } from "../rules/checks";
import { Degree } from "../rules/degrees";
import {
  applyCondition,
  clearCondition,
  conditionIsImmune,
  normalizeConditionName,
} from "../rules/conditions";
import {
  applyDamageModifiers,
  applyDamageToPool,
  rollDamage,
} from "../rules/damage";
import { SaveProfile, resolveSave } from "../rules/saves";

export type LifecycleEvent = [string, Record<string, unknown>];

function unitSaveProfile(state: BattleState, unitId: string): SaveProfile {
  const unit = state.units[unitId];
  return { fortitude: unit.fortitude, reflex: unit.reflex, will: unit.will };
}

function stageByNumber(
  stages: Array<Record<string, unknown>>,
  stageNumber: number,
): Record<string, unknown> | null {
  for (const stage of stages) {
    if (Number(stage["stage"] ?? 0) === stageNumber) return stage;
  }
  return null;
}

function durationToRounds(duration: unknown, defaultRounds = 1): number {
  if (typeof duration !== "object" || duration === null) return defaultRounds;
  const d = duration as Record<string, unknown>;
  const amount = Number(d["amount"] ?? 0);
  const unit = String(d["unit"] ?? "");
  if (amount <= 0) return defaultRounds;
  if (unit === "round") return amount;
  if (unit === "minute") return amount * 10;
  if (unit === "hour") return amount * 600;
  if (unit === "day") return amount * 14400;
  return defaultRounds;
}

function applyAfflictionStage(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
  stageNumber: number,
): Record<string, unknown> {
  const target = state.units[effect.targetUnitId ?? ""];
  if (!target || !unitAlive(target)) {
    return { stage: stageNumber, applied: false, reason: "target_missing_or_dead" };
  }

  const stages = (effect.payload["stages"] as Array<Record<string, unknown>>) ?? [];
  const stage = stageByNumber(stages, stageNumber);
  if (!stage) {
    return {
      stage: stageNumber,
      applied: false,
      reason: "stage_not_found",
      targetHp: target.hp,
    };
  }

  const persistentConditions = new Set<string>(
    ((effect.payload["persistent_conditions"] as string[]) ?? [])
      .map((n) => String(n).replace(/ /g, "_"))
      .filter((n) => n.trim()),
  );
  const oldApplied: Record<string, number> = {};
  for (const [name, value] of Object.entries(
    (effect.payload["applied_conditions"] as Record<string, unknown>) ?? {},
  )) {
    if (String(name).trim()) oldApplied[String(name)] = Number(value);
  }

  const damageResults: Record<string, unknown>[] = [];
  for (const dmg of (stage["damage"] as Array<Record<string, unknown>>) ?? []) {
    const formula = String(dmg["formula"] ?? "");
    if (!formula) continue;
    const damageType = String(dmg["damage_type"] ?? "").toLowerCase() || null;
    const bypass = ((dmg["bypass"] as string[]) ?? []).map((x) =>
      String(x).toLowerCase(),
    );
    const roll = rollDamage(rng, formula);
    const adjustment = applyDamageModifiers({
      rawTotal: roll.total,
      damageType,
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
    const detail: Record<string, unknown> = {
      formula,
      damage_type: damageType ?? "untyped",
      rolls: roll.rolls,
      flat_modifier: roll.flatModifier,
      raw_total: adjustment.rawTotal,
      total: adjustment.appliedTotal,
      immune: adjustment.immune,
      resistance_total: adjustment.resistanceTotal,
      weakness_total: adjustment.weaknessTotal,
    };
    if (bypass.length > 0) detail["bypass"] = bypass;
    if (appliedDamage.absorbedByTempHp > 0)
      detail["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;
    damageResults.push(detail);
  }

  const stageConditionValues: Record<string, number> = {};
  const appliedConditions: Record<string, unknown>[] = [];
  const skippedConditions: Record<string, unknown>[] = [];
  for (const cond of (stage["conditions"] as Array<Record<string, unknown>>) ?? []) {
    const name = normalizeConditionName(String(cond["condition"] ?? ""));
    if (!name) continue;
    const value = Number(cond["value"] ?? 1);
    if (conditionIsImmune(name, target.conditionImmunities)) {
      skippedConditions.push({ name, value, reason: "condition_immune" });
      continue;
    }
    const oldValue = oldApplied[name];
    const current = Number(target.conditions[name] ?? 0);
    if (oldValue !== undefined && current === oldValue) {
      target.conditions[name] = value;
    } else {
      target.conditions = applyCondition(target.conditions, name, value);
    }
    stageConditionValues[name] = value;
    appliedConditions.push({ name, value });
  }

  const clearedConditions: string[] = [];
  for (const [name, oldValue] of Object.entries(oldApplied)) {
    if (name in stageConditionValues) continue;
    if (persistentConditions.has(name)) continue;
    if (Number(target.conditions[name] ?? 0) === oldValue) {
      target.conditions = clearCondition(target.conditions, name);
      clearedConditions.push(name);
    }
  }

  // Track only this affliction's current contribution
  const trackedApplied: Record<string, number> = { ...stageConditionValues };
  for (const name of persistentConditions) {
    if (name in oldApplied && Number(target.conditions[name] ?? 0) === oldApplied[name]) {
      trackedApplied[name] = oldApplied[name];
    }
  }
  effect.payload["applied_conditions"] = trackedApplied;
  const stageRounds = durationToRounds(stage["duration"], 1);
  effect.payload["stage_rounds_remaining"] = stageRounds;

  if (target.hp === 0) {
    target.conditions = applyCondition(target.conditions, "unconscious", 1);
  }

  return {
    stage: stageNumber,
    applied: true,
    damage: damageResults,
    conditions: appliedConditions,
    skipped_conditions: skippedConditions,
    cleared_conditions: clearedConditions,
    stage_rounds: stageRounds,
    target_hp: target.hp,
  };
}

function afflictionDelta(degree: Degree): number {
  if (degree === "critical_success") return -2;
  if (degree === "success") return -1;
  if (degree === "failure") return 1;
  return 2; // critical_failure
}

function onAfflictionTick(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
): LifecycleEvent[] {
  const target = state.units[effect.targetUnitId ?? ""];
  if (!target || !unitAlive(target)) return [];

  const currentStage = Number(effect.payload["current_stage"] ?? 1);
  const stages =
    (effect.payload["stages"] as Array<Record<string, unknown>>) ?? [];
  const maxStage = Math.max(
    ...stages.map((s) => Number(s["stage"] ?? 0)),
    currentStage,
  );
  let stageRoundsRemaining = Number(effect.payload["stage_rounds_remaining"] ?? 1);

  if (stageRoundsRemaining > 1) {
    effect.payload["stage_rounds_remaining"] = stageRoundsRemaining - 1;
    return [
      [
        "effect_tick",
        {
          effect_id: effect.effectId,
          kind: effect.kind,
          target: target.unitId,
          stage_from: currentStage,
          stage_to: currentStage,
          waiting: true,
          remaining_stage_rounds: effect.payload["stage_rounds_remaining"],
          target_hp: target.hp,
        },
      ],
    ];
  }

  const saveCfg = (effect.payload["save"] as Record<string, unknown>) ?? {};
  let saveDetail: Record<string, unknown> | null = null;
  let nextStage = currentStage;

  if (Object.keys(saveCfg).length > 0) {
    const dc = Number(saveCfg["dc"] ?? 0);
    const saveType = String(saveCfg["save_type"] ?? "Fortitude");
    if (dc > 0) {
      const save = resolveSave(
        rng,
        saveType,
        unitSaveProfile(state, target.unitId),
        dc,
      );
      nextStage = Math.max(0, Math.min(maxStage, currentStage + afflictionDelta(save.degree)));
      saveDetail = {
        dc,
        save_type: saveType,
        die: save.die,
        modifier: save.modifier,
        total: save.total,
        degree: save.degree,
      };
    }
  }

  effect.payload["current_stage"] = nextStage;
  if (nextStage <= 0) {
    effect.durationRounds = 0;
    return [
      [
        "effect_tick",
        {
          effect_id: effect.effectId,
          kind: effect.kind,
          target: target.unitId,
          stage_from: currentStage,
          stage_to: nextStage,
          save: saveDetail,
          cured: true,
          target_hp: target.hp,
        },
      ],
    ];
  }

  const stageResult = applyAfflictionStage(state, effect, rng, nextStage);
  return [
    [
      "effect_tick",
      {
        effect_id: effect.effectId,
        kind: effect.kind,
        target: target.unitId,
        stage_from: currentStage,
        stage_to: nextStage,
        save: saveDetail,
        stage_result: stageResult,
      },
    ],
  ];
}

export function onApply(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  if (effect.targetUnitId === null) return events;
  const target = state.units[effect.targetUnitId];
  if (!target || !unitAlive(target)) return events;

  if (effect.kind === "condition") {
    const name = normalizeConditionName(String(effect.payload["name"] ?? ""));
    const value = Number(effect.payload["value"] ?? 1);
    if (name) {
      const applied = !conditionIsImmune(name, target.conditionImmunities);
      if (applied) {
        target.conditions = applyCondition(target.conditions, name, value);
      }
      events.push([
        "effect_apply",
        {
          effect_id: effect.effectId,
          kind: effect.kind,
          target: target.unitId,
          condition: name,
          value,
          applied,
          reason: applied ? null : "condition_immune",
        },
      ]);
    }
  } else if (effect.kind === "temp_hp") {
    const amount = Number(effect.payload["amount"] ?? 0);
    const stackMode = String(effect.payload["stack_mode"] ?? "max");
    const crossSource = String(effect.payload["cross_source"] ?? "higher_only");
    let sourceKey = String(effect.payload["source_key"] ?? "");
    if (!sourceKey) {
      sourceKey = effect.sourceUnitId
        ? `unit:${effect.sourceUnitId}`
        : `effect:${effect.effectId}`;
    }

    const before = Number(target.tempHp);
    const beforeSource = target.tempHpSource;
    const beforeOwner = target.tempHpOwnerEffectId;
    let after = before;
    let afterSource = beforeSource;
    let afterOwner = beforeOwner;
    let reason: string | null = null;
    let decision = "ignored";

    if (amount <= 0) {
      reason = "invalid_amount";
    } else if (!["max", "add"].includes(stackMode)) {
      reason = "invalid_stack_mode";
    } else if (!["higher_only", "replace", "ignore"].includes(crossSource)) {
      reason = "invalid_cross_source_policy";
    } else {
      const sameSource =
        beforeSource === sourceKey || (before === 0 && beforeSource === null);
      if (sameSource) {
        decision = "same_source_refresh";
        if (stackMode === "add") {
          after = before + amount;
        } else {
          after = Math.max(before, amount);
        }
        afterSource = after > 0 ? sourceKey : null;
        afterOwner = after > 0 ? effect.effectId : null;
      } else if (crossSource === "ignore") {
        decision = "cross_source_ignored";
        reason = "cross_source_policy_ignore";
      } else if (crossSource === "replace") {
        decision = "cross_source_replaced";
        after = amount;
        afterSource = sourceKey;
        afterOwner = effect.effectId;
      } else {
        if (amount > before) {
          decision = "cross_source_replaced";
          after = amount;
          afterSource = sourceKey;
          afterOwner = effect.effectId;
        } else {
          decision = "cross_source_ignored";
          reason = "lower_or_equal_than_current";
        }
      }
    }

    target.tempHp = Math.max(0, after);
    target.tempHpSource = target.tempHp > 0 ? afterSource : null;
    target.tempHpOwnerEffectId = target.tempHp > 0 ? afterOwner : null;

    const granted = Math.max(0, target.tempHp - before);
    const applied =
      target.tempHp !== before ||
      target.tempHpSource !== beforeSource ||
      target.tempHpOwnerEffectId !== beforeOwner;

    effect.payload["applied_temp_hp"] = granted;
    effect.payload["temp_hp_source_key"] = sourceKey;
    effect.payload["stack_mode"] = stackMode;
    effect.payload["cross_source"] = crossSource;

    events.push([
      "effect_apply",
      {
        effect_id: effect.effectId,
        kind: effect.kind,
        target: target.unitId,
        requested_amount: amount,
        stack_mode: stackMode,
        cross_source: crossSource,
        source_key: sourceKey,
        temp_hp_before: before,
        temp_hp_after: target.tempHp,
        temp_hp_source_before: beforeSource,
        temp_hp_source_after: target.tempHpSource,
        granted,
        applied,
        decision,
        reason,
      },
    ]);
  } else if (effect.kind === "affliction") {
    const stage = Number(effect.payload["current_stage"] ?? 1);
    if (!effect.payload["applied_conditions"]) effect.payload["applied_conditions"] = {};
    if (!effect.payload["persistent_conditions"])
      effect.payload["persistent_conditions"] = [];
    const stageResult = applyAfflictionStage(state, effect, rng, stage);
    events.push([
      "effect_apply",
      {
        effect_id: effect.effectId,
        kind: effect.kind,
        target: target.unitId,
        stage,
        stage_result: stageResult,
      },
    ]);
  } else {
    events.push([
      "effect_apply",
      {
        effect_id: effect.effectId,
        kind: effect.kind,
        target: target.unitId,
      },
    ]);
  }

  return events;
}

function applyPersistentDamage(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const target = state.units[effect.targetUnitId ?? ""];
  if (!target || !unitAlive(target)) return events;

  const formula = String(effect.payload["formula"] ?? "");
  const damageType = String(effect.payload["damage_type"] ?? "").toLowerCase() || null;
  if (!formula) return events;

  const roll = rollDamage(rng, formula);
  const bypass = ((effect.payload["bypass"] as string[]) ?? []).map((x) =>
    String(x).toLowerCase(),
  );
  const adjustment = applyDamageModifiers({
    rawTotal: roll.total,
    damageType,
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
  if (target.hp === 0) {
    target.conditions = applyCondition(target.conditions, "unconscious", 1);
  }

  let recovery: Record<string, unknown> | null = null;
  if (effect.payload["recovery_check"] !== false) {
    const recoveryDc = Number(effect.payload["recovery_dc"] ?? 15);
    const recoveryMod = Number(effect.payload["recovery_modifier"] ?? 0);
    const check = resolveCheck(rng, recoveryMod, recoveryDc);
    const recovered = check.degree === "success" || check.degree === "critical_success";
    recovery = {
      dc: recoveryDc,
      modifier: recoveryMod,
      die: check.die,
      total: check.total,
      degree: check.degree,
      recovered,
    };
    if (recovered) {
      effect.payload["_expire_now"] = true;
    }
  }

  const damagePayload: Record<string, unknown> = {
    formula,
    rolls: roll.rolls,
    flat_modifier: roll.flatModifier,
    raw_total: adjustment.rawTotal,
    total: adjustment.appliedTotal,
    damage_type: damageType ?? "untyped",
    immune: adjustment.immune,
    resistance_total: adjustment.resistanceTotal,
    weakness_total: adjustment.weaknessTotal,
  };
  if (bypass.length > 0) damagePayload["bypass"] = bypass;
  if (appliedDamage.absorbedByTempHp > 0)
    damagePayload["temp_hp_absorbed"] = appliedDamage.absorbedByTempHp;

  events.push([
    "effect_tick",
    {
      effect_id: effect.effectId,
      kind: effect.kind,
      target: target.unitId,
      damage: damagePayload,
      recovery,
      target_hp: target.hp,
    },
  ]);
  return events;
}

export function onTurnStart(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
): LifecycleEvent[] {
  if (effect.kind === "persistent_damage") {
    return applyPersistentDamage(state, effect, rng);
  }
  return [];
}

export function onTurnEnd(
  state: BattleState,
  effect: EffectState,
  rng: DeterministicRNG,
): LifecycleEvent[] {
  if (effect.kind === "persistent_damage") {
    return applyPersistentDamage(state, effect, rng);
  }
  if (effect.kind === "affliction") {
    return onAfflictionTick(state, effect, rng);
  }
  return [];
}

export function onExpire(
  state: BattleState,
  effect: EffectState,
  _rng: DeterministicRNG,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];

  if (effect.kind === "condition" && effect.targetUnitId) {
    const target = state.units[effect.targetUnitId];
    if (target) {
      if (effect.payload["clear_on_expire"] !== false) {
        const name = String(effect.payload["name"] ?? "");
        if (name) {
          target.conditions = clearCondition(target.conditions, name);
          events.push([
            "effect_expire",
            {
              effect_id: effect.effectId,
              kind: effect.kind,
              target: target.unitId,
              cleared_condition: name,
            },
          ]);
          return events;
        }
      }
    }
  }

  if (effect.kind === "affliction" && effect.targetUnitId) {
    const target = state.units[effect.targetUnitId];
    if (target) {
      const persistentConditions = new Set<string>(
        ((effect.payload["persistent_conditions"] as string[]) ?? [])
          .map((n) => String(n).replace(/ /g, "_"))
          .filter((n) => n.trim()),
      );
      const appliedConditions: Record<string, number> = {};
      for (const [name, value] of Object.entries(
        (effect.payload["applied_conditions"] as Record<string, unknown>) ?? {},
      )) {
        if (String(name).trim()) appliedConditions[String(name)] = Number(value);
      }
      const cleared: string[] = [];
      for (const [name, value] of Object.entries(appliedConditions)) {
        if (persistentConditions.has(name)) continue;
        if (Number(target.conditions[name] ?? 0) === value) {
          target.conditions = clearCondition(target.conditions, name);
          cleared.push(name);
        }
      }
      events.push([
        "effect_expire",
        {
          effect_id: effect.effectId,
          kind: effect.kind,
          target: target.unitId,
          cleared_conditions: cleared.sort(),
          persistent_conditions: [...persistentConditions].sort(),
        },
      ]);
      return events;
    }
  }

  if (effect.kind === "temp_hp" && effect.targetUnitId) {
    const target = state.units[effect.targetUnitId];
    if (target) {
      const removeOnExpire = effect.payload["remove_on_expire"] !== false;
      const sourceKey = String(effect.payload["temp_hp_source_key"] ?? "");
      const ownerMatch = target.tempHpOwnerEffectId === effect.effectId;
      const sourceMatch = target.tempHpSource === sourceKey;
      let removed = 0;
      if (removeOnExpire && ownerMatch && sourceMatch && target.tempHp > 0) {
        removed = target.tempHp;
        target.tempHp = 0;
        target.tempHpSource = null;
        target.tempHpOwnerEffectId = null;
      }
      events.push([
        "effect_expire",
        {
          effect_id: effect.effectId,
          kind: effect.kind,
          target: target.unitId,
          stack_mode: String(effect.payload["stack_mode"] ?? "max"),
          cross_source: String(effect.payload["cross_source"] ?? "higher_only"),
          source_key: sourceKey,
          remove_on_expire: removeOnExpire,
          owner_match: ownerMatch,
          source_match: sourceMatch,
          removed_temp_hp: removed,
          temp_hp_after: target.tempHp,
        },
      ]);
      return events;
    }
  }

  events.push([
    "effect_expire",
    {
      effect_id: effect.effectId,
      kind: effect.kind,
      target: effect.targetUnitId,
    },
  ]);
  return events;
}

export function processTiming(
  state: BattleState,
  rng: DeterministicRNG,
  timing: "turn_start" | "turn_end",
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const active = state.turnOrder[state.turnIndex];

  const toExpire: string[] = [];
  for (const effect of Object.values(state.effects)) {
    if (effect.targetUnitId !== active) continue;

    if (effect.tickTiming === timing) {
      if (timing === "turn_start") {
        events.push(...onTurnStart(state, effect, rng));
      } else if (timing === "turn_end") {
        events.push(...onTurnEnd(state, effect, rng));
      }
    }

    if (effect.payload["_expire_now"]) {
      delete effect.payload["_expire_now"];
      toExpire.push(effect.effectId);
      continue;
    }

    if (timing === "turn_end" && effect.durationRounds !== null) {
      effect.durationRounds -= 1;
      events.push([
        "effect_duration",
        {
          effect_id: effect.effectId,
          remaining_rounds: effect.durationRounds,
          target: effect.targetUnitId,
        },
      ]);
      if (effect.durationRounds <= 0) {
        toExpire.push(effect.effectId);
      }
    }
  }

  for (const effectId of toExpire) {
    const effect = state.effects[effectId];
    if (!effect) continue;
    events.push(...onExpire(state, effect, rng));
    delete state.effects[effectId];
  }

  return events;
}
