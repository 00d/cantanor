/**
 * Deterministic forecast helpers for browser-facing command previews.
 * Mirrors engine/core/forecast.py
 */

import { parseFormula } from "../rules/damage";
import { degreeOfSuccess, Degree } from "../rules/degrees";
import { basicSaveMultiplier } from "../rules/saves";

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function degreeOdds(
  modifier: number,
  dc: number,
): Record<string, number> {
  const counts: Record<Degree, number> = {
    critical_success: 0,
    success: 0,
    failure: 0,
    critical_failure: 0,
  };
  for (let die = 1; die <= 20; die++) {
    const total = die + modifier;
    const degree = degreeOfSuccess(total, dc, die);
    counts[degree]++;
  }
  return {
    critical_success: round6(counts.critical_success / 20),
    success: round6(counts.success / 20),
    failure: round6(counts.failure / 20),
    critical_failure: round6(counts.critical_failure / 20),
  };
}

export function expectedDamageAverage(formula: string): number {
  const [diceCount, diceSize, modifier] = parseFormula(formula);
  if (diceCount <= 0) {
    return round6(Math.max(0, modifier));
  }
  const avg = diceCount * ((diceSize + 1) / 2) + modifier;
  return round6(Math.max(0, avg));
}

export function strikeForecast(
  attackModifier: number,
  dc: number,
  damageFormula: string,
): Record<string, unknown> {
  const odds = degreeOdds(attackModifier, dc);
  const avg = expectedDamageAverage(damageFormula);
  const expectedPerAttack =
    avg * odds["success"] + avg * 2 * odds["critical_success"];
  return {
    kind: "strike",
    attack_modifier: attackModifier,
    dc,
    damage_formula: damageFormula,
    degree_odds: odds,
    expected_damage_raw: {
      on_success: avg,
      on_critical_success: round6(avg * 2),
      per_attack: round6(expectedPerAttack),
    },
  };
}

export function castSpellForecast(
  saveModifier: number,
  dc: number,
  damageFormula: string,
  mode = "basic",
): Record<string, unknown> {
  const odds = degreeOdds(saveModifier, dc);
  const avg = expectedDamageAverage(damageFormula);

  let expectedMultiplier: number;
  if (mode !== "basic") {
    expectedMultiplier = 1.0;
  } else {
    expectedMultiplier =
      basicSaveMultiplier("critical_success") * odds["critical_success"] +
      basicSaveMultiplier("success") * odds["success"] +
      basicSaveMultiplier("failure") * odds["failure"] +
      basicSaveMultiplier("critical_failure") * odds["critical_failure"];
  }

  return {
    kind: "cast_spell",
    save_modifier: saveModifier,
    dc,
    mode,
    damage_formula: damageFormula,
    degree_odds: odds,
    expected_multiplier: round6(expectedMultiplier),
    expected_damage_raw: round6(avg * expectedMultiplier),
  };
}
