/**
 * Tests for checks, saves, and degree-of-success rules.
 * Ported from tests/contract/test_checks_and_saves.py
 */

import { describe, test, expect } from "vitest";
import { degreeOfSuccess } from "./degrees";
import { resolveCheck } from "./checks";
import { resolveSave, basicSaveMultiplier, SaveProfile } from "./saves";
import { DeterministicRNG } from "../engine/rng";

describe("Checks and Saves", () => {
  test("degree of success with natural 20 improves by one step", () => {
    // 10 vs DC 20 = critical_failure, but nat 20 improves to failure
    const result = degreeOfSuccess(10, 20, 20);
    expect(result).toBe("failure");
  });

  test("degree of success with natural 1 worsens by one step", () => {
    // 20 vs DC 10 = critical_success, but nat 1 worsens to success
    const result = degreeOfSuccess(20, 10, 1);
    expect(result).toBe("success");
  });

  test("check is deterministic for same seed", () => {
    const rng1 = new DeterministicRNG(999);
    const rng2 = new DeterministicRNG(999);

    const c1 = resolveCheck(rng1, 7, 18);
    const c2 = resolveCheck(rng2, 7, 18);

    expect(c1.die).toBe(c2.die);
    expect(c1.total).toBe(c2.total);
    expect(c1.degree).toBe(c2.degree);
  });

  test("save resolution uses selected modifier", () => {
    const rng = new DeterministicRNG(7);
    const profile: SaveProfile = { fortitude: 5, reflex: 2, will: 9 };

    const result = resolveSave(rng, "Will", profile, 20);

    expect(result.modifier).toBe(9);
  });

  test("basic save multipliers", () => {
    expect(basicSaveMultiplier("critical_success")).toBe(0.0);
    expect(basicSaveMultiplier("success")).toBe(0.5);
    expect(basicSaveMultiplier("failure")).toBe(1.0);
    expect(basicSaveMultiplier("critical_failure")).toBe(2.0);
  });
});
