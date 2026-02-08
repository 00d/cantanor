// @ts-nocheck - Test fixtures use dynamic types
/**
 * Tests for damage and conditions.
 * Ported from tests/contract/test_damage_and_conditions.py
 */

import { describe, test, expect } from "vitest";
import {
  parseFormula,
  rollDamage,
  applyDamageModifiers,
  applyDamageToPool,
} from "./damage";
import {
  applyCondition,
  clearCondition,
  conditionIsImmune,
} from "./conditions";
import { DeterministicRNG } from "../engine/rng";

describe("Damage and Conditions", () => {
  describe("Damage Formula Parsing", () => {
    test("parses dice notation", () => {
      const [count, size, mod] = parseFormula("2d6+3");
      expect(count).toBe(2);
      expect(size).toBe(6);
      expect(mod).toBe(3);
    });

    test("parses flat damage", () => {
      const [count, size, mod] = parseFormula("10");
      expect(count).toBe(0);
      expect(size).toBe(1);
      expect(mod).toBe(10);
    });
  });

  describe("Damage Rolling", () => {
    test("damage roll is deterministic for same seed", () => {
      const rng1 = new DeterministicRNG(42);
      const rng2 = new DeterministicRNG(42);

      const r1 = rollDamage(rng1, "1d8+2");
      const r2 = rollDamage(rng2, "1d8+2");

      expect(r1.total).toBe(r2.total);
      expect(r1.rolls).toEqual(r2.rolls);
    });
  });

  describe("Damage Modifiers", () => {
    test("apply immunity, resistance, and weakness", () => {
      // Immunity takes precedence
      const immune = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: { fire: 5 },
        weaknesses: { fire: 3 },
        immunities: ["fire"],
      });

      expect(immune.appliedTotal).toBe(0);
      expect(immune.immune).toBe(true);

      // Without immunity, resistance and weakness apply
      const adjusted = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: { fire: 5 },
        weaknesses: { fire: 3 },
        immunities: [],
      });

      // 12 - 5 (resistance) + 3 (weakness) = 10
      expect(adjusted.appliedTotal).toBe(10);
      expect(adjusted.immune).toBe(false);
    });

    test("apply grouped type tags (physical/energy)", () => {
      // Slashing is physical damage
      const physical = applyDamageModifiers({
        rawTotal: 12,
        damageType: "slashing",
        resistances: { physical: 4 },
        weaknesses: {},
        immunities: [],
      });

      expect(physical.appliedTotal).toBe(8);

      // Fire is energy damage
      const energy = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: {},
        weaknesses: { energy: 3 },
        immunities: [],
      });

      expect(energy.appliedTotal).toBe(15);

      // Electricity is energy damage, immune to energy
      const immune = applyDamageModifiers({
        rawTotal: 12,
        damageType: "electricity",
        resistances: {},
        weaknesses: {},
        immunities: ["energy"],
      });

      expect(immune.appliedTotal).toBe(0);
      expect(immune.immune).toBe(true);
    });

    test("use highest matching resistance and weakness values", () => {
      const adjusted = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: { fire: 5, energy: 3, all: 1 },
        weaknesses: { fire: 4, energy: 2, all: 1 },
        immunities: [],
      });

      expect(adjusted.resistanceTotal).toBe(5); // highest resistance
      expect(adjusted.weaknessTotal).toBe(4); // highest weakness
      expect(adjusted.appliedTotal).toBe(11); // 12 - 5 + 4
    });

    test("allow bypass of resistance and immunity", () => {
      // Bypass resistance
      const resisted = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: { fire: 5 },
        weaknesses: {},
        immunities: [],
        bypass: ["fire"],
      });

      expect(resisted.appliedTotal).toBe(12);
      expect(resisted.resistanceTotal).toBe(0);

      // Bypass immunity
      const immune = applyDamageModifiers({
        rawTotal: 12,
        damageType: "fire",
        resistances: {},
        weaknesses: {},
        immunities: ["fire"],
        bypass: ["fire"],
      });

      expect(immune.immune).toBe(false);
      expect(immune.appliedTotal).toBe(12);
    });
  });

  describe("Conditions", () => {
    test("apply condition keeps highest value", () => {
      let c = {};
      c = applyCondition(c, "frightened", 1);
      c = applyCondition(c, "frightened", 3);
      c = applyCondition(c, "frightened", 2);

      expect(c["frightened"]).toBe(3);
    });

    test("clear condition removes key", () => {
      let c = {};
      c = applyCondition(c, "unconscious", 1);
      c = clearCondition(c, "unconscious");

      expect("unconscious" in c).toBe(false);
    });

    test("condition immunity normalizes names and supports global immunity", () => {
      expect(conditionIsImmune("Frightened", ["frightened"])).toBe(true);
      expect(conditionIsImmune("Frightened", ["all_conditions"])).toBe(true);
      expect(conditionIsImmune("Frightened", ["clumsy"])).toBe(false);
    });
  });

  describe("Damage Application to HP Pool", () => {
    test("consumes temp HP before HP", () => {
      const result = applyDamageToPool({
        hp: 20,
        tempHp: 5,
        damageTotal: 9,
      });

      expect(result.absorbedByTempHp).toBe(5);
      expect(result.hpLoss).toBe(4);
      expect(result.newTempHp).toBe(0);
      expect(result.newHp).toBe(16);
    });
  });
});
