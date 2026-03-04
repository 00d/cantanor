/**
 * Turn order helpers.
 * Mirrors engine/core/turn_order.py
 */

import { UnitState } from "./state";

export function buildTurnOrder(units: Record<string, UnitState>): string[] {
  // Higher initiative acts first; ties break by stable unit id.
  const ordered = Object.values(units).sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    return a.unitId.localeCompare(b.unitId);
  });
  return ordered.map((u) => u.unitId);
}

export function nextTurnIndex(current: number, turnOrderSize: number): number {
  return (current + 1) % turnOrderSize;
}
