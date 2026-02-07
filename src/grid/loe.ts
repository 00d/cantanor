/**
 * Line of effect helpers.
 * Mirrors engine/grid/loe.py
 *
 * Pathfinder 2e ORC cover rules: standard cover (+2 AC), greater cover (+4 AC).
 */

import { BattleState, UnitState, unitAlive } from "../engine/state";
import { linePoints } from "./areas";
import { inBounds, isBlocked } from "./map";

export type CoverGrade = "none" | "standard" | "greater" | "blocked";

function sign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

export function hasTileLineOfEffect(
  state: BattleState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): boolean {
  if (!inBounds(state, sourceX, sourceY)) return false;
  if (!inBounds(state, targetX, targetY)) return false;

  const path = linePoints(sourceX, sourceY, targetX, targetY);
  for (let idx = 0; idx < path.length; idx++) {
    const [x, y] = path[idx];
    if (idx === 0) continue;

    const [prevX, prevY] = path[idx - 1];
    const stepX = x - prevX;
    const stepY = y - prevY;

    // Corner pinch check for diagonal movement
    if (Math.abs(stepX) === 1 && Math.abs(stepY) === 1) {
      const sideA: [number, number] = [prevX + stepX, prevY];
      const sideB: [number, number] = [prevX, prevY + stepY];
      const sideABlocked =
        inBounds(state, sideA[0], sideA[1]) &&
        isBlocked(state, sideA[0], sideA[1]);
      const sideBBlocked =
        inBounds(state, sideB[0], sideB[1]) &&
        isBlocked(state, sideB[0], sideB[1]);
      if (sideABlocked && sideBBlocked) return false;
    }

    if (idx === path.length - 1) {
      // Allow targeting an occupied endpoint tile
      return !isBlocked(state, x, y);
    }
    if (isBlocked(state, x, y)) return false;
  }
  return true;
}

export function coverGradeBetweenTiles(
  state: BattleState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): CoverGrade {
  if (!hasTileLineOfEffect(state, sourceX, sourceY, targetX, targetY)) {
    return "blocked";
  }

  const sx = sign(sourceX - targetX);
  const sy = sign(sourceY - targetY);
  if (sx === 0 && sy === 0) return "none";

  let candidates: Array<[number, number]>;
  if (sx === 0) {
    candidates = [
      [targetX - 1, targetY],
      [targetX + 1, targetY],
    ];
  } else if (sy === 0) {
    candidates = [
      [targetX, targetY - 1],
      [targetX, targetY + 1],
    ];
  } else {
    candidates = [
      [targetX + sx, targetY],
      [targetX, targetY + sy],
    ];
  }

  let blockedCount = 0;
  for (const [x, y] of candidates) {
    if (inBounds(state, x, y) && isBlocked(state, x, y)) {
      blockedCount++;
    }
  }

  if (blockedCount >= 2) return "greater";
  if (blockedCount === 1) return "standard";
  return "none";
}

export function coverAcBonusFromGrade(grade: CoverGrade): number {
  if (grade === "standard") return 2;
  if (grade === "greater") return 4;
  return 0;
}

export function coverAcBonusBetweenTiles(
  state: BattleState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): number {
  return coverAcBonusFromGrade(
    coverGradeBetweenTiles(state, sourceX, sourceY, targetX, targetY),
  );
}

export function hasLineOfEffect(
  state: BattleState,
  source: UnitState,
  target: UnitState,
): boolean {
  if (!unitAlive(source) || !unitAlive(target)) return false;
  return hasTileLineOfEffect(state, source.x, source.y, target.x, target.y);
}

export function coverGradeForUnits(
  state: BattleState,
  source: UnitState,
  target: UnitState,
): CoverGrade {
  if (!unitAlive(source) || !unitAlive(target)) return "blocked";
  return coverGradeBetweenTiles(state, source.x, source.y, target.x, target.y);
}

export function coverAcBonusForUnits(
  state: BattleState,
  source: UnitState,
  target: UnitState,
): number {
  if (!unitAlive(source) || !unitAlive(target)) return 0;
  return coverAcBonusBetweenTiles(state, source.x, source.y, target.x, target.y);
}
