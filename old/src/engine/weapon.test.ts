import { describe, it, expect } from "vitest";
import { resolveWeapon } from "./state";
import { applyCommand } from "./reducer";
import { DeterministicRNG } from "./rng";
import {
  createTestUnit,
  createTestBattle,
  createRangedUnit,
  createMixedUnit,
  createAgileUnit,
  createDeadlyUnit,
  createThrownUnit,
  createTestRNG,
} from "../test-utils/fixtures";

describe("resolveWeapon", () => {
  it("backward compat: no weapons array → synthesized melee", () => {
    const unit = createTestUnit({ attackMod: 7, damage: "2d6", attackDamageType: "slashing", reach: 2 });
    const w = resolveWeapon(unit);
    expect(w.type).toBe("melee");
    expect(w.attackMod).toBe(7);
    expect(w.damage).toBe("2d6");
    expect(w.damageType).toBe("slashing");
    expect(w.reach).toBe(2);
  });

  it("resolves weapon from weapons array by index", () => {
    const unit = createMixedUnit();
    const melee = resolveWeapon(unit, 0);
    expect(melee.name).toBe("longsword");
    expect(melee.type).toBe("melee");
    const ranged = resolveWeapon(unit, 1);
    expect(ranged.name).toBe("shortbow");
    expect(ranged.type).toBe("ranged");
  });

  it("defaults to index 0 when no index specified", () => {
    const unit = createMixedUnit();
    const w = resolveWeapon(unit);
    expect(w.name).toBe("longsword");
  });

  it("throws on invalid weapon index", () => {
    const unit = createMixedUnit();
    expect(() => resolveWeapon(unit, 5)).toThrow("invalid weapon index");
    expect(() => resolveWeapon(unit, -1)).toThrow("invalid weapon index");
  });
});

describe("ranged strike in reducer", () => {
  it("ranged basic: strike succeeds within range", () => {
    const archer = createRangedUnit({ unitId: "archer", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { archer, target },
      turnOrder: ["archer", "target"],
    });
    const rng = createTestRNG();
    const [next, events] = applyCommand(battle, { type: "strike", actor: "archer", target: "target", weapon_index: 0 }, rng);
    expect(events.length).toBe(1);
    expect((events[0] as Record<string, unknown>)["type"]).toBe("strike");
    // Attack resolved — check actions consumed
    expect(next.units["archer"].actionsRemaining).toBe(2);
    expect(next.units["archer"].attacksThisTurn).toBe(1);
  });

  it("ranged: fails beyond maxRange", () => {
    const archer = createRangedUnit({ unitId: "archer", x: 0, y: 0 });
    // Default maxRange = 6 * 6 = 36
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 9, y: 9, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { archer, target },
      turnOrder: ["archer", "target"],
      battleMap: { width: 40, height: 40, blocked: [] },
    });
    // Chebyshev distance = 9, within 36 — should work
    const rng = createTestRNG();
    expect(() => applyCommand(battle, { type: "strike", actor: "archer", target: "target", weapon_index: 0 }, rng)).not.toThrow();

    // Now test beyond max range
    const farTarget = createTestUnit({ unitId: "far", team: "enemy", x: 37, y: 0, hp: 20, maxHp: 20 });
    const battle2 = createTestBattle({
      units: { archer: createRangedUnit({ unitId: "archer", x: 0, y: 0 }), far: farTarget },
      turnOrder: ["archer", "far"],
      battleMap: { width: 40, height: 40, blocked: [] },
    });
    expect(() => applyCommand(battle2, { type: "strike", actor: "archer", target: "far", weapon_index: 0 }, createTestRNG())).toThrow("out of range");
  });

  it("range increment penalty: -2 per increment past first", () => {
    // rangeIncrement = 6, target at distance 8 (Chebyshev)
    // increments past first = ceil(8/6) - 1 = 2 - 1 = 1 → penalty = -2
    const archer = createRangedUnit({ unitId: "archer", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 8, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { archer, target },
      turnOrder: ["archer", "target"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(battle, { type: "strike", actor: "archer", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    const roll = payload["roll"] as Record<string, unknown>;
    expect(roll["range_penalty"]).toBe(-2);
  });

  it("melee from weapons array: reach check works", () => {
    const fighter = createMixedUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = createTestRNG();
    // Melee (weapon 0) should work at distance 1
    expect(() => applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng)).not.toThrow();

    // Melee at distance 2 should fail (reach = 1)
    const farTarget = createTestUnit({ unitId: "far", team: "enemy", x: 2, y: 0, hp: 20, maxHp: 20 });
    const battle2 = createTestBattle({
      units: { fighter: createMixedUnit({ unitId: "fighter", x: 0, y: 0 }), far: farTarget },
      turnOrder: ["fighter", "far"],
    });
    expect(() => applyCommand(battle2, { type: "strike", actor: "fighter", target: "far", weapon_index: 0 }, createTestRNG())).toThrow("out of reach");
  });

  it("invalid weapon_index → ReductionError", () => {
    const fighter = createMixedUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    expect(() =>
      applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 99 }, createTestRNG()),
    ).toThrow("invalid weapon index");
  });

  it("weapon_index in event payload", () => {
    const fighter = createMixedUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["weapon_index"]).toBe(0);
  });

  it("backward compat: strike without weapons array uses flat fields", () => {
    const attacker = createTestUnit({ unitId: "attacker", x: 0, y: 0, attackMod: 10, damage: "2d6", team: "player" });
    const defender = createTestUnit({ unitId: "defender", x: 1, y: 0, team: "enemy", hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { attacker, defender },
      turnOrder: ["attacker", "defender"],
    });
    const rng = createTestRNG();
    expect(() => applyCommand(battle, { type: "strike", actor: "attacker", target: "defender" }, rng)).not.toThrow();
  });
});

// =========================================================================
// Weapon trait integration tests
// =========================================================================

describe("agile MAP trait", () => {
  it("-4 on 2nd attack, -8 on 3rd", () => {
    const fighter = createAgileUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 100, maxHp: 100 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = createTestRNG();

    // 1st attack: MAP = 0
    const [s1, e1] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const roll1 = ((e1[0] as Record<string, unknown>)["payload"] as Record<string, unknown>)["roll"] as Record<string, unknown>;
    expect(roll1["map_penalty"]).toBe(0);

    // 2nd attack: MAP = -4 (agile)
    const [s2, e2] = applyCommand(s1, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const roll2 = ((e2[0] as Record<string, unknown>)["payload"] as Record<string, unknown>)["roll"] as Record<string, unknown>;
    expect(roll2["map_penalty"]).toBe(-4);

    // 3rd attack: MAP = -8 (agile)
    const [, e3] = applyCommand(s2, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const roll3 = ((e3[0] as Record<string, unknown>)["payload"] as Record<string, unknown>)["roll"] as Record<string, unknown>;
    expect(roll3["map_penalty"]).toBe(-8);
  });
});

describe("deadly trait", () => {
  /**
   * Helper: find a seed where a given attack modifier vs AC crits.
   * We iterate seeds until the strike event has degree "critical_success".
   */
  function findCritSeed(attackMod: number, ac: number): number {
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createDeadlyUnit({ unitId: "fighter", x: 0, y: 0, weapons: [{
        name: "war pick", type: "melee", attackMod, damage: "1d8+4",
        damageType: "piercing", reach: 1, traits: ["deadly_d10"],
      }] });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "critical_success") return seed;
    }
    throw new Error("could not find crit seed");
  }

  function findNonCritHitSeed(ac: number): number {
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createDeadlyUnit({ unitId: "fighter", x: 0, y: 0 });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "success") return seed;
    }
    throw new Error("could not find hit seed");
  }

  it("on crit: deadly_bonus present in damage detail", () => {
    const seed = findCritSeed(10, 5);
    const fighter = createDeadlyUnit({ unitId: "fighter", x: 0, y: 0, weapons: [{
      name: "war pick", type: "melee", attackMod: 10, damage: "1d8+4",
      damageType: "piercing", reach: 1, traits: ["deadly_d10"],
    }] });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 5 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = new DeterministicRNG(seed);
    const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["degree"]).toBe("critical_success");
    const dmg = payload["damage"] as Record<string, unknown>;
    expect(dmg["deadly_bonus"]).toBeGreaterThan(0);
    expect(dmg["deadly_rolls"]).toBeDefined();
  });

  it("on non-crit: no deadly_bonus", () => {
    const seed = findNonCritHitSeed(15);
    const fighter = createDeadlyUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 15 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = new DeterministicRNG(seed);
    const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["degree"]).toBe("success");
    const dmg = payload["damage"] as Record<string, unknown>;
    expect(dmg["deadly_bonus"]).toBeUndefined();
  });
});

describe("fatal trait", () => {
  function findCritSeed(attackMod: number, ac: number): number {
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createTestUnit({
        unitId: "fighter", x: 0, y: 0, team: "player",
        weapons: [{
          name: "scythe", type: "melee", attackMod, damage: "1d10+4",
          damageType: "slashing", reach: 1, traits: ["fatal_d12"],
        }],
      });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "critical_success") return seed;
    }
    throw new Error("could not find crit seed");
  }

  it("on crit: fatal_bonus present and dice upgraded", () => {
    const seed = findCritSeed(10, 5);
    const fighter = createTestUnit({
      unitId: "fighter", x: 0, y: 0, team: "player",
      weapons: [{
        name: "scythe", type: "melee", attackMod: 10, damage: "1d10+4",
        damageType: "slashing", reach: 1, traits: ["fatal_d12"],
      }],
    });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 5 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = new DeterministicRNG(seed);
    const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["degree"]).toBe("critical_success");
    const dmg = payload["damage"] as Record<string, unknown>;
    expect(dmg["fatal_bonus"]).toBeGreaterThan(0);
    expect(dmg["fatal_rolls"]).toBeDefined();
  });

  it("on non-crit: no fatal_bonus", () => {
    // Use a high AC so success is likely (not crit)
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createTestUnit({
        unitId: "fighter", x: 0, y: 0, team: "player",
        weapons: [{
          name: "scythe", type: "melee", attackMod: 10, damage: "1d10+4",
          damageType: "slashing", reach: 1, traits: ["fatal_d12"],
        }],
      });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 15 });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "success") {
        const dmg = payload["damage"] as Record<string, unknown>;
        expect(dmg["fatal_bonus"]).toBeUndefined();
        return;
      }
    }
    throw new Error("could not find hit-only seed");
  });
});

describe("propulsive trait", () => {
  it("adds propulsiveMod to damage", () => {
    // Use a high attack mod and low AC to guarantee a hit
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createTestUnit({
        unitId: "fighter", x: 0, y: 0, team: "player",
        weapons: [{
          name: "composite longbow", type: "ranged", attackMod: 12, damage: "1d8",
          damageType: "piercing", rangeIncrement: 6, propulsiveMod: 2, traits: ["propulsive"],
        }],
      });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0, hp: 200, maxHp: 200, ac: 5 });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "success" || payload["degree"] === "critical_success") {
        const dmg = payload["damage"] as Record<string, unknown>;
        expect(dmg["propulsive_bonus"]).toBe(2);
        return;
      }
    }
    throw new Error("could not find hit seed");
  });
});

describe("volley trait", () => {
  it("-2 penalty within volley range", () => {
    // Weapon with volley_3 at dist 2
    const archer = createTestUnit({
      unitId: "archer", x: 0, y: 0, team: "player",
      weapons: [{
        name: "longbow", type: "ranged", attackMod: 8, damage: "1d8",
        damageType: "piercing", rangeIncrement: 10, traits: ["volley_3"],
      }],
    });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 2, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { archer, target },
      turnOrder: ["archer", "target"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(battle, { type: "strike", actor: "archer", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    const roll = payload["roll"] as Record<string, unknown>;
    expect(roll["volley_penalty"]).toBe(-2);
  });

  it("no penalty beyond volley range", () => {
    const archer = createTestUnit({
      unitId: "archer", x: 0, y: 0, team: "player",
      weapons: [{
        name: "longbow", type: "ranged", attackMod: 8, damage: "1d8",
        damageType: "piercing", rangeIncrement: 10, traits: ["volley_3"],
      }],
    });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { archer, target },
      turnOrder: ["archer", "target"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(battle, { type: "strike", actor: "archer", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    const roll = payload["roll"] as Record<string, unknown>;
    expect(roll["volley_penalty"]).toBeUndefined();
  });
});

describe("thrown trait", () => {
  it("melee at range: succeeds within thrown range", () => {
    const fighter = createThrownUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 3, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = createTestRNG();
    expect(() => applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng)).not.toThrow();
  });

  it("melee at melee range: uses melee (no range penalty)", () => {
    const fighter = createThrownUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    const roll = payload["roll"] as Record<string, unknown>;
    expect(roll["range_penalty"]).toBe(0);
  });

  it("thrown beyond range: fails", () => {
    const fighter = createThrownUnit({ unitId: "fighter", x: 0, y: 0 });
    const target = createTestUnit({ unitId: "target", team: "enemy", x: 5, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { fighter, target },
      turnOrder: ["fighter", "target"],
    });
    expect(() =>
      applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, createTestRNG()),
    ).toThrow("out of range");
  });

  it("thrown in reaction_strike: rejected (must be melee reach)", () => {
    // AoO unit with thrown weapon — target at distance 3 (beyond melee reach)
    const aooUnit = createTestUnit({
      unitId: "aoo_unit", team: "enemy", x: 0, y: 0,
      reactions: ["attack_of_opportunity"],
      reactionAvailable: true,
      weapons: [{
        name: "javelin", type: "melee", attackMod: 8, damage: "1d6+3",
        damageType: "piercing", reach: 1, traits: ["thrown_4"],
      }],
    });
    const mover = createTestUnit({ unitId: "mover", team: "player", x: 3, y: 0, hp: 200, maxHp: 200 });
    const battle = createTestBattle({
      units: { aoo_unit: aooUnit, mover },
      turnOrder: ["mover", "aoo_unit"],
    });
    // Reaction strike at range 3 should fail because reaction strikes are melee only
    expect(() =>
      applyCommand(battle, { type: "reaction_strike", actor: "aoo_unit", target: "mover", weapon_index: 0 }, createTestRNG()),
    ).toThrow("out of reach");
  });
});

describe("combined traits: fatal + deadly", () => {
  it("on crit: both fatal_bonus and deadly_bonus present", () => {
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createTestUnit({
        unitId: "fighter", x: 0, y: 0, team: "player",
        weapons: [{
          name: "orc necksplitter", type: "melee", attackMod: 20, damage: "1d8+4",
          damageType: "slashing", reach: 1, traits: ["fatal_d12", "deadly_d10"],
        }],
      });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 5 });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      if (payload["degree"] === "critical_success") {
        const dmg = payload["damage"] as Record<string, unknown>;
        expect(dmg["fatal_bonus"]).toBeGreaterThan(0);
        expect(dmg["deadly_bonus"]).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error("could not find crit seed");
  });
});

describe("combined traits: agile + deadly", () => {
  it("agile MAP and deadly bonus both applied", () => {
    for (let seed = 1; seed < 1000; seed++) {
      const fighter = createTestUnit({
        unitId: "fighter", x: 0, y: 0, team: "player",
        attacksThisTurn: 1, // Simulate 2nd attack
        weapons: [{
          name: "sai", type: "melee", attackMod: 20, damage: "1d6+4",
          damageType: "piercing", reach: 1, traits: ["agile", "deadly_d10"],
        }],
      });
      const target = createTestUnit({ unitId: "target", team: "enemy", x: 1, y: 0, hp: 200, maxHp: 200, ac: 5 });
      const battle = createTestBattle({
        units: { fighter, target },
        turnOrder: ["fighter", "target"],
      });
      const rng = new DeterministicRNG(seed);
      const [, events] = applyCommand(battle, { type: "strike", actor: "fighter", target: "target", weapon_index: 0 }, rng);
      const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
      const roll = payload["roll"] as Record<string, unknown>;
      expect(roll["map_penalty"]).toBe(-4); // agile 2nd attack

      if (payload["degree"] === "critical_success") {
        const dmg = payload["damage"] as Record<string, unknown>;
        expect(dmg["deadly_bonus"]).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error("could not find crit seed");
  });
});
