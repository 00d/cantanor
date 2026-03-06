/**
 * Pure weapon-trait helper functions.
 *
 * Centralises trait parsing so the reducer, forecast, tooltip, and overlay
 * all share the same logic without duplication.
 */

import type { WeaponData } from "./state";

/** True when the weapon has a trait with the given exact name. */
export function hasTrait(weapon: WeaponData, name: string): boolean {
  return weapon.traits?.includes(name) ?? false;
}

/**
 * Extract the numeric suffix from a prefixed trait.
 *
 *   traitValue(w, "deadly_d")  → 10  (from "deadly_d10")
 *   traitValue(w, "volley_")   → 30  (from "volley_30")
 *   traitValue(w, "thrown_")   → 4   (from "thrown_4")
 *
 * Returns null if no matching trait is found.
 */
export function traitValue(weapon: WeaponData, prefix: string): number | null {
  if (!weapon.traits) return null;
  for (const t of weapon.traits) {
    if (t.startsWith(prefix)) {
      const n = parseInt(t.slice(prefix.length), 10);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

/** True when the weapon carries the "agile" trait. */
export function isAgile(weapon: WeaponData): boolean {
  return hasTrait(weapon, "agile");
}

/**
 * PF2e Multiple Attack Penalty.
 *   agile:     0 / -4 / -8
 *   non-agile: 0 / -5 / -10
 */
export function mapPenalty(attacksThisTurn: number, agile: boolean): number {
  if (attacksThisTurn <= 0) return 0;
  if (agile) {
    return attacksThisTurn === 1 ? -4 : -8;
  }
  return attacksThisTurn === 1 ? -5 : -10;
}

/**
 * Volley penalty: -2 when target is within N tiles (from "volley_N").
 * Returns 0 if the weapon has no volley trait or target is beyond N.
 */
export function volleyPenalty(weapon: WeaponData, dist: number): number {
  const v = traitValue(weapon, "volley_");
  if (v === null) return 0;
  return dist <= v ? -2 : 0;
}

/** Returns die size from "deadly_dN" (e.g. 10 from "deadly_d10"), or null. */
export function deadlyDice(weapon: WeaponData): number | null {
  return traitValue(weapon, "deadly_d");
}

/** Returns die size from "fatal_dN" (e.g. 12 from "fatal_d12"), or null. */
export function fatalDice(weapon: WeaponData): number | null {
  return traitValue(weapon, "fatal_d");
}

/** Returns range from "thrown_N" (e.g. 4 from "thrown_4"), or null. */
export function thrownRange(weapon: WeaponData): number | null {
  return traitValue(weapon, "thrown_");
}
