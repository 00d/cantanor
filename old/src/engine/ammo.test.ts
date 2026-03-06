/**
 * Tests for ammunition, reload, and hands validation.
 */

import { describe, test, expect } from "vitest";
import { applyCommand } from "./reducer";
import { DeterministicRNG } from "./rng";
import { createTestBattle, createTestUnit, createCrossbowUnit } from "../test-utils/fixtures";
import { resolveWeapon } from "./state";

describe("Ammunition", () => {
  test("crossbow unit starts with ammo", () => {
    const unit = createCrossbowUnit();
    expect(unit.weaponAmmo).toEqual({ 0: 1 });
    const weapon = resolveWeapon(unit, 0);
    expect(weapon.ammo).toBe(1);
    expect(weapon.reload).toBe(1);
  });

  test("firing crossbow decrements ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createCrossbowUnit({ unitId: "archer", team: "pc", x: 0, y: 0 }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0, hp: 100, maxHp: 100 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    const [next] = applyCommand(battle, {
      type: "strike",
      actor: "archer",
      target: "target",
      weapon_index: 0,
    }, rng);
    expect(next.units["archer"].weaponAmmo![0]).toBe(0);
  });

  test("cannot fire crossbow with no ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createCrossbowUnit({ unitId: "archer", team: "pc", x: 0, y: 0, weaponAmmo: { 0: 0 } }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    expect(() => applyCommand(battle, {
      type: "strike",
      actor: "archer",
      target: "target",
      weapon_index: 0,
    }, rng)).toThrow("no ammo remaining");
  });

  test("weapon without ammo field has infinite ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createTestUnit({
          unitId: "archer", team: "pc", x: 0, y: 0,
          weapons: [{
            name: "bow",
            type: "ranged",
            attackMod: 8,
            damage: "1d6",
            damageType: "piercing",
            rangeIncrement: 6,
          }],
        }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0, hp: 100, maxHp: 100 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    // Should not throw — no ammo field means infinite
    const [next] = applyCommand(battle, {
      type: "strike",
      actor: "archer",
      target: "target",
      weapon_index: 0,
    }, rng);
    expect(next.units["archer"].weaponAmmo).toBeUndefined();
  });
});

describe("Reload", () => {
  test("reload restores 1 ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createCrossbowUnit({ unitId: "archer", team: "pc", x: 0, y: 0, weaponAmmo: { 0: 0 } }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    const [next, events] = applyCommand(battle, {
      type: "reload",
      actor: "archer",
      weapon_index: 0,
    }, rng);
    expect(next.units["archer"].weaponAmmo![0]).toBe(1);
    expect(next.units["archer"].actionsRemaining).toBe(2);
    const reloadEvent = events.find(e => e["type"] === "reload");
    expect(reloadEvent).toBeTruthy();
  });

  test("cannot reload weapon that does not use ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createTestUnit({
          unitId: "archer", team: "pc", x: 0, y: 0,
          weapons: [{
            name: "bow",
            type: "ranged",
            attackMod: 8,
            damage: "1d6",
            damageType: "piercing",
            rangeIncrement: 6,
          }],
        }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    expect(() => applyCommand(battle, {
      type: "reload",
      actor: "archer",
      weapon_index: 0,
    }, rng)).toThrow("does not use ammo");
  });

  test("cannot reload when already at max ammo", () => {
    const battle = createTestBattle({
      units: {
        archer: createCrossbowUnit({ unitId: "archer", team: "pc", x: 0, y: 0 }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);
    expect(() => applyCommand(battle, {
      type: "reload",
      actor: "archer",
      weapon_index: 0,
    }, rng)).toThrow("already fully loaded");
  });

  test("fire-reload-fire cycle works", () => {
    const battle = createTestBattle({
      units: {
        archer: createCrossbowUnit({ unitId: "archer", team: "pc", x: 0, y: 0 }),
        target: createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0, hp: 100, maxHp: 100 }),
      },
      turnOrder: ["archer", "target"],
    });
    const rng = new DeterministicRNG(42);

    // Fire (3→2 actions, 1→0 ammo)
    const [s1] = applyCommand(battle, {
      type: "strike", actor: "archer", target: "target", weapon_index: 0,
    }, rng);
    expect(s1.units["archer"].weaponAmmo![0]).toBe(0);
    expect(s1.units["archer"].actionsRemaining).toBe(2);

    // Reload (2→1 actions, 0→1 ammo)
    const [s2] = applyCommand(s1, {
      type: "reload", actor: "archer", weapon_index: 0,
    }, rng);
    expect(s2.units["archer"].weaponAmmo![0]).toBe(1);
    expect(s2.units["archer"].actionsRemaining).toBe(1);

    // Fire again (1→0 actions, 1→0 ammo)
    const [s3] = applyCommand(s2, {
      type: "strike", actor: "archer", target: "target", weapon_index: 0,
    }, rng);
    expect(s3.units["archer"].weaponAmmo![0]).toBe(0);
    expect(s3.units["archer"].actionsRemaining).toBe(0);
  });
});

describe("Shield AC Bonus", () => {
  test("raised shield grants +2 AC on strike", () => {
    const battle = createTestBattle({
      units: {
        attacker: createTestUnit({ unitId: "attacker", team: "pc", x: 0, y: 0, attackMod: 10 }),
        defender: createTestUnit({
          unitId: "defender", team: "enemy", x: 1, y: 0, ac: 15, hp: 50, maxHp: 50,
          shieldHardness: 5, shieldHp: 20, shieldMaxHp: 20, shieldRaised: true,
        }),
      },
      turnOrder: ["attacker", "defender"],
    });
    const rng = new DeterministicRNG(42);
    const [, events] = applyCommand(battle, {
      type: "strike", actor: "attacker", target: "defender",
    }, rng);
    const strikeEvent = events.find(e => e["type"] === "strike")!;
    const roll = strikeEvent["payload"] as Record<string, unknown>;
    const rollData = roll["roll"] as Record<string, unknown>;
    // DC should be 17 (AC 15 + 2 shield), not 15
    expect(rollData["dc"]).toBe(17);
  });
});

describe("Hands Validation", () => {
  test("cannot raise shield with 2H weapon", () => {
    const battle = createTestBattle({
      units: {
        fighter: createTestUnit({
          unitId: "fighter",
          team: "pc",
          x: 0, y: 0,
          shieldHardness: 5,
          shieldHp: 20,
          shieldMaxHp: 20,
          shieldRaised: false,
          weapons: [{
            name: "greatsword",
            type: "melee",
            attackMod: 10,
            damage: "1d12+4",
            damageType: "slashing",
            hands: 2,
          }],
        }),
        enemy: createTestUnit({ unitId: "enemy", team: "enemy", x: 1, y: 0 }),
      },
      turnOrder: ["fighter", "enemy"],
    });
    const rng = new DeterministicRNG(42);
    expect(() => applyCommand(battle, {
      type: "raise_shield", actor: "fighter",
    }, rng)).toThrow("two-handed weapon");
  });

  test("can raise shield with 1H weapon", () => {
    const battle = createTestBattle({
      units: {
        fighter: createTestUnit({
          unitId: "fighter",
          team: "pc",
          x: 0, y: 0,
          shieldHardness: 5,
          shieldHp: 20,
          shieldMaxHp: 20,
          shieldRaised: false,
          weapons: [{
            name: "longsword",
            type: "melee",
            attackMod: 10,
            damage: "1d8+4",
            damageType: "slashing",
            hands: 1,
          }],
        }),
        enemy: createTestUnit({ unitId: "enemy", team: "enemy", x: 1, y: 0 }),
      },
      turnOrder: ["fighter", "enemy"],
    });
    const rng = new DeterministicRNG(42);
    const [next] = applyCommand(battle, {
      type: "raise_shield", actor: "fighter",
    }, rng);
    expect(next.units["fighter"].shieldRaised).toBe(true);
  });
});
