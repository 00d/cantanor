/**
 * Grid map helpers.
 */

import { BattleState, unitAlive } from "../engine/state";

export function inBounds(state: BattleState, x: number, y: number): boolean {
  return x >= 0 && x < state.battleMap.width && y >= 0 && y < state.battleMap.height;
}

export function isBlocked(state: BattleState, x: number, y: number): boolean {
  return state.battleMap.blocked.some(([bx, by]) => bx === x && by === y);
}

export function isOccupied(state: BattleState, x: number, y: number): boolean {
  return Object.values(state.units).some(
    (unit) => unitAlive(unit) && unit.x === x && unit.y === y,
  );
}

/** PF2e 5ft grid: convert a distance in feet to a tile radius. */
export function tilesFromFeet(feet: number): number {
  return Math.max(1, Math.floor((feet + 4) / 5));
}
