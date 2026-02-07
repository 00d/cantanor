/**
 * Summon effect handler scaffold.
 * Mirrors engine/effects/handlers/summon.py
 */

import { Effect } from "../base";

export function handleSummon(effect: Effect): Record<string, unknown> {
  return {
    status: "ok",
    kind: "summon",
    source: effect.sourceUnitId,
    payload: effect.payload,
  };
}
