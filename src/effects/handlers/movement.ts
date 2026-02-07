/**
 * Movement effect handler scaffold.
 * Mirrors engine/effects/handlers/movement.py
 */

import { Effect } from "../base";

export function handleMovement(effect: Effect): Record<string, unknown> {
  return {
    status: "ok",
    kind: "movement",
    target: effect.targetUnitId,
    payload: effect.payload,
  };
}
