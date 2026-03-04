/**
 * Campaign state — pure functions for party snapshot, merge, and camp healing.
 */

import type { BattleState, UnitState } from "../engine/state";
import { unitAlive } from "../engine/state";
import type { PartySnapshot } from "./campaignTypes";

/** Conditions that persist between battles (e.g. drained, doomed). */
const PERSISTENT_CONDITIONS = new Set(["drained", "doomed"]);

/**
 * Snapshot surviving PC units at end of battle.
 * Captures HP, ability uses, and persistent conditions.
 */
export function snapshotParty(
  battle: BattleState,
  pcTeam = "pc",
): PartySnapshot[] {
  const snapshots: PartySnapshot[] = [];
  for (const unit of Object.values(battle.units)) {
    if (unit.team !== pcTeam) continue;
    if (!unitAlive(unit)) continue;
    const persistentConditions: Record<string, number> = {};
    for (const [cond, val] of Object.entries(unit.conditions)) {
      if (PERSISTENT_CONDITIONS.has(cond)) {
        persistentConditions[cond] = val;
      }
    }
    snapshots.push({
      unitId: unit.unitId,
      hp: unit.hp,
      maxHp: unit.maxHp,
      abilitiesRemaining: { ...unit.abilitiesRemaining },
      persistentConditions,
      ...(unit.weaponAmmo && { weaponAmmo: { ...unit.weaponAmmo } }),
    });
  }
  return snapshots;
}

/**
 * Merges party snapshots into freshly loaded units.
 * Applies saved HP, abilities, and persistent conditions.
 */
export function applyPartySnapshot(
  units: Record<string, UnitState>,
  snapshots: PartySnapshot[],
): Record<string, UnitState> {
  const result = { ...units };
  for (const snap of snapshots) {
    const unit = result[snap.unitId];
    if (!unit) continue;
    result[snap.unitId] = {
      ...unit,
      hp: Math.min(snap.hp, unit.maxHp),
      abilitiesRemaining: { ...snap.abilitiesRemaining },
      conditions: { ...unit.conditions, ...snap.persistentConditions },
      ...(snap.weaponAmmo && { weaponAmmo: { ...snap.weaponAmmo } }),
    };
  }
  return result;
}

/**
 * Full heal at camp: restore HP to max, clear all persistent conditions.
 * Ability uses are reset (for spells/feats — items stay consumed).
 */
export function healPartyAtCamp(snapshots: PartySnapshot[]): PartySnapshot[] {
  return snapshots.map((snap) => {
    const healed: PartySnapshot = {
      ...snap,
      hp: snap.maxHp,
      persistentConditions: {},
    };
    // Remove weaponAmmo from snapshot so units reload from weapon defaults at battle start
    delete healed.weaponAmmo;
    return healed;
  });
}

/**
 * Reset ability uses for a new battle.
 * Spells/feats get refreshed. Items (prefixed with "item.") stay consumed.
 */
export function resetAbilitiesForBattle(
  abilitiesRemaining: Record<string, number>,
  abilityDefaults: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, maxUses] of Object.entries(abilityDefaults)) {
    if (id.startsWith("item.")) {
      // Items persist — use remaining count from snapshot
      result[id] = abilitiesRemaining[id] ?? 0;
    } else {
      // Spells/feats reset to max
      result[id] = maxUses;
    }
  }
  return result;
}
