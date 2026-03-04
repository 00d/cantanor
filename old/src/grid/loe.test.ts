/**
 * Tests for line of effect and cover mechanics.
 * Ported from tests/contract/test_line_of_effect.py
 *
 * These tests are CRITICAL for tactical combat - they validate:
 * - Line of effect blocking (walls, diagonal corners)
 * - Cover grade calculations (standard +2 AC, greater +4 AC)
 * - AC bonus from cover
 */

import { describe, test, expect } from "vitest";
import { battleStateFromScenario } from "../io/scenarioLoader";
import {
  hasTileLineOfEffect,
  coverGradeBetweenTiles,
  coverAcBonusBetweenTiles,
} from "./loe";

function createScenario(blocked: Array<[number, number]>) {
  return {
    battle_id: "line_of_effect",
    seed: 111,
    map: { width: 8, height: 8, blocked },
    units: [
      {
        id: "a",
        team: "pc",
        hp: 10,
        position: [1, 1],
        initiative: 20,
        attack_mod: 0,
        ac: 10,
        damage: "1d1",
      },
      {
        id: "b",
        team: "enemy",
        hp: 10,
        position: [5, 1],
        initiative: 10,
        attack_mod: 0,
        ac: 10,
        damage: "1d1",
      },
    ],
    commands: [],
  };
}

describe("Line of Effect", () => {
  test("has LOE when path is clear", () => {
    const state = battleStateFromScenario(createScenario([]));
    expect(hasTileLineOfEffect(state, 1, 1, 5, 1)).toBe(true);
  });

  test("no LOE when blocked by wall", () => {
    const state = battleStateFromScenario(createScenario([[3, 1]]));
    expect(hasTileLineOfEffect(state, 1, 1, 5, 1)).toBe(false);
  });

  test("no LOE when diagonal corner pinched (CRITICAL EDGE CASE)", () => {
    // Both adjacent tiles blocked = diagonal blocked
    const state = battleStateFromScenario(
      createScenario([
        [2, 1],
        [1, 2],
      ]),
    );
    expect(hasTileLineOfEffect(state, 1, 1, 2, 2)).toBe(false);
  });

  test("has LOE for diagonal when only one adjacent blocked", () => {
    // Only one adjacent blocked = diagonal passes
    const state = battleStateFromScenario(createScenario([[2, 1]]));
    expect(hasTileLineOfEffect(state, 1, 1, 2, 2)).toBe(true);
  });
});

describe("Cover Grade", () => {
  test("standard cover from one adjacent blocked tile", () => {
    // Block one tile adjacent to target = standard cover
    const state = battleStateFromScenario(createScenario([[5, 0]]));
    expect(coverGradeBetweenTiles(state, 1, 1, 5, 1)).toBe("standard");
  });

  test("greater cover from two adjacent blocked tiles", () => {
    // Block two tiles adjacent to target = greater cover
    const state = battleStateFromScenario(
      createScenario([
        [5, 0],
        [5, 2],
      ]),
    );
    expect(coverGradeBetweenTiles(state, 1, 1, 5, 1)).toBe("greater");
  });

  test("no cover when no adjacent blocked tiles", () => {
    const state = battleStateFromScenario(createScenario([]));
    expect(coverGradeBetweenTiles(state, 1, 1, 5, 1)).toBe("none");
  });

  test("blocked grade when LOE fully blocked", () => {
    const state = battleStateFromScenario(createScenario([[3, 1]]));
    expect(coverGradeBetweenTiles(state, 1, 1, 5, 1)).toBe("blocked");
  });
});

describe("Cover AC Bonus", () => {
  test("standard cover grants +2 AC", () => {
    const state = battleStateFromScenario(createScenario([[5, 0]]));
    expect(coverAcBonusBetweenTiles(state, 1, 1, 5, 1)).toBe(2);
  });

  test("greater cover grants +4 AC", () => {
    const state = battleStateFromScenario(
      createScenario([
        [5, 0],
        [5, 2],
      ]),
    );
    expect(coverAcBonusBetweenTiles(state, 1, 1, 5, 1)).toBe(4);
  });

  test("no cover grants +0 AC", () => {
    const state = battleStateFromScenario(createScenario([]));
    expect(coverAcBonusBetweenTiles(state, 1, 1, 5, 1)).toBe(0);
  });

  test("blocked grants +0 AC (can't attack through wall)", () => {
    const state = battleStateFromScenario(createScenario([[3, 1]]));
    expect(coverAcBonusBetweenTiles(state, 1, 1, 5, 1)).toBe(0);
  });
});

describe("Cover Edge Cases", () => {
  test("diagonal attack checks perpendicular-adjacent tiles for cover", () => {
    // When attacking diagonally from (1,1) to (2,2), cover comes from
    // perpendicular-adjacent tiles: (1,2) and (2,1)
    const state = battleStateFromScenario(
      createScenario([
        [1, 2], // One perpendicular-adjacent to target
      ]),
    );
    expect(coverGradeBetweenTiles(state, 1, 1, 2, 2)).toBe("standard");
  });

  test("horizontal attack checks vertical-adjacent tiles for cover", () => {
    // When attacking horizontally, cover comes from vertical-adjacent tiles
    const state = battleStateFromScenario(
      createScenario([
        [5, 0], // Above target
      ]),
    );
    expect(coverGradeBetweenTiles(state, 1, 1, 5, 1)).toBe("standard");
  });

  test("vertical attack checks horizontal-adjacent tiles for cover", () => {
    // When attacking vertically, cover comes from horizontal-adjacent tiles
    const state = battleStateFromScenario(
      createScenario([
        [0, 5], // Left of target
      ]),
    );
    expect(coverGradeBetweenTiles(state, 1, 1, 1, 5)).toBe("standard");
  });
});
