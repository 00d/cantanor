/**
 * Saving throw resolution.
 * Mirrors engine/rules/saves.py
 */

import { DeterministicRNG } from "../engine/rng";
import { CheckResult, resolveCheck } from "./checks";
import { Degree } from "./degrees";

export interface SaveProfile {
  fortitude: number;
  reflex: number;
  will: number;
}

export function resolveSave(
  rng: DeterministicRNG,
  saveType: string,
  profile: SaveProfile,
  dc: number,
): CheckResult {
  const lookup: Record<string, number> = {
    Fortitude: profile.fortitude,
    Reflex: profile.reflex,
    Will: profile.will,
  };
  const modifier = lookup[saveType] ?? 0;
  return resolveCheck(rng, modifier, dc);
}

export function basicSaveMultiplier(degree: Degree): number {
  if (degree === "critical_success") return 0.0;
  if (degree === "success") return 0.5;
  if (degree === "failure") return 1.0;
  return 2.0; // critical_failure
}
