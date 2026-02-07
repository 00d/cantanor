/**
 * Condition effect handler scaffold.
 * Mirrors engine/effects/handlers/condition.py
 */

import { Effect } from "../base";

export function handleCondition(effect: Effect): Record<string, unknown> {
  return {
    status: "ok",
    kind: "condition",
    target: effect.targetUnitId,
    payload: effect.payload,
  };
}
