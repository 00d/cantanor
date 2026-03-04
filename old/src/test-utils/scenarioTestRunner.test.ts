/**
 * Smoke test for test infrastructure.
 * Verifies that test utilities are working correctly.
 */

import { describe, test, expect } from "vitest";
import { createTestUnit, createTestBattle, createTestRNG, createCombatBattle } from "./fixtures";
import { assertNoCommandErrors, getEventsByType } from "./scenarioTestRunner";

describe("Test Infrastructure", () => {
  test("createTestUnit produces valid unit", () => {
    const unit = createTestUnit();
    expect(unit.unitId).toBe("test_unit");
    expect(unit.hp).toBe(10);
    expect(unit.maxHp).toBe(10);
    expect(unit.team).toBe("player");
  });

  test("createTestUnit accepts overrides", () => {
    const unit = createTestUnit({ unitId: "custom_id", hp: 50, maxHp: 50 });
    expect(unit.unitId).toBe("custom_id");
    expect(unit.hp).toBe(50);
    expect(unit.maxHp).toBe(50);
  });

  test("createTestBattle produces valid battle state", () => {
    const battle = createTestBattle();
    expect(battle.battleId).toBe("test_battle");
    expect(battle.seed).toBe(101);
    expect(battle.roundNumber).toBe(1);
    expect(battle.turnIndex).toBe(0);
    expect(Object.keys(battle.units).length).toBeGreaterThan(0);
  });

  test("createTestRNG is deterministic", () => {
    const rng1 = createTestRNG(999);
    const rng2 = createTestRNG(999);

    const roll1 = rng1.d20();
    const roll2 = rng2.d20();

    expect(roll1.value).toBe(roll2.value);
    expect(roll1.low).toBe(1);
    expect(roll1.high).toBe(20);
  });

  test("createCombatBattle produces two-unit setup", () => {
    const battle = createCombatBattle();
    expect(Object.keys(battle.units).length).toBe(2);
    expect(battle.units["attacker"]).toBeDefined();
    expect(battle.units["defender"]).toBeDefined();
    expect(battle.units["attacker"].team).toBe("player");
    expect(battle.units["defender"].team).toBe("enemy");
  });

  test("assertNoCommandErrors throws on errors", () => {
    const events = [
      { type: "turn_start", payload: {} },
      { type: "command_error", payload: { error: "test error" } },
    ];

    expect(() => assertNoCommandErrors(events)).toThrow();
  });

  test("assertNoCommandErrors passes with no errors", () => {
    const events = [
      { type: "turn_start", payload: {} },
      { type: "strike_resolved", payload: {} },
    ];

    expect(() => assertNoCommandErrors(events)).not.toThrow();
  });

  test("getEventsByType filters correctly", () => {
    const events = [
      { type: "turn_start", payload: {} },
      { type: "strike_resolved", payload: {} },
      { type: "turn_start", payload: {} },
      { type: "damage_applied", payload: {} },
    ];

    const turnStartEvents = getEventsByType(events, "turn_start");
    expect(turnStartEvents.length).toBe(2);
    expect(turnStartEvents.every((e) => e.type === "turn_start")).toBe(true);
  });
});
