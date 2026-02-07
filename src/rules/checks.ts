/**
 * Core check and attack-roll resolution.
 * Mirrors engine/rules/checks.py
 */

import { DeterministicRNG } from "../engine/rng";
import { Degree, degreeOfSuccess } from "./degrees";

export interface CheckResult {
  die: number;
  modifier: number;
  total: number;
  dc: number;
  degree: Degree;
}

export function resolveCheck(
  rng: DeterministicRNG,
  modifier: number,
  dc: number,
): CheckResult {
  const roll = rng.d20();
  const total = roll.value + modifier;
  return {
    die: roll.value,
    modifier,
    total,
    dc,
    degree: degreeOfSuccess(total, dc, roll.value),
  };
}
