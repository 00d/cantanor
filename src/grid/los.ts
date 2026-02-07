/**
 * Line of sight helpers.
 * Mirrors engine/grid/los.py
 */

import { BattleState, UnitState } from "../engine/state";
import { hasLineOfEffect } from "./loe";

export function hasLineOfSight(
  state: BattleState,
  source: UnitState,
  target: UnitState,
): boolean {
  return hasLineOfEffect(state, source, target);
}
