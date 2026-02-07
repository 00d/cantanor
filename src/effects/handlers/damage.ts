/**
 * Damage effect handler scaffold.
 * Mirrors engine/effects/handlers/damage.py
 */

import { Effect } from "../base";

export function handleDamage(effect: Effect): Record<string, unknown> {
  return {
    status: "ok",
    kind: "damage",
    target: effect.targetUnitId,
    payload: effect.payload,
  };
}
