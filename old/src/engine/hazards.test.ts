/**
 * Spatial hazard zone tick — reducer behaviour.
 *
 * Hazards tick at start of a unit's turn (inside the end_turn handler, after
 * advanceTurn). A unit standing on a covered tile rolls a basic save; flat
 * damage × save multiplier × resistances is applied.
 */

import { describe, it, expect } from "vitest";
import { applyCommand } from "./reducer";
import { DeterministicRNG } from "./rng";
import { createTestUnit, createTestBattle, createTestRNG } from "../test-utils/fixtures";
import type { HazardZone } from "./state";

function hazard(overrides: Partial<HazardZone> = {}): HazardZone {
  return {
    id: "lava",
    damageType: "fire",
    damagePerTurn: 5,
    dc: 14,
    saveType: "Reflex",
    tiles: [[2, 2]],
    ...overrides,
  };
}

/** Seed 101 with reflex +5 vs DC 14: first d20 → failure (multiplier 1.0). */
const FAIL_SEED = 101;

describe("hazard zones — start-of-turn tick", () => {
  it("ticks damage when the newly active unit stands on a hazard tile", () => {
    // u1 is active, ends turn → u2 becomes active, u2 is at (2,2) on the lava.
    const u1 = createTestUnit({ unitId: "u1", team: "a", x: 0, y: 0 });
    const u2 = createTestUnit({ unitId: "u2", team: "b", x: 2, y: 2, hp: 20, maxHp: 20, reflex: 5 });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard()] },
    });

    const rng = new DeterministicRNG(FAIL_SEED);
    const [next, events] = applyCommand(battle, { type: "end_turn", actor: "u1" }, rng);

    // u2 took damage
    expect(next.units["u2"].hp).toBeLessThan(20);

    // hazard_tick event emitted with correct shape
    const tick = events.find((e) => e["type"] === "hazard_tick");
    expect(tick).toBeDefined();
    const p = tick!["payload"] as Record<string, unknown>;
    expect(p["target"]).toBe("u2");
    expect(p["hazard_id"]).toBe("lava");
    expect(p["save_type"]).toBe("Reflex");
    expect((p["damage"] as Record<string, unknown>)["damage_type"]).toBe("fire");
    expect((p["damage"] as Record<string, unknown>)["applied_total"]).toBeGreaterThan(0);
  });

  it("does not tick when the unit is not on a hazard tile", () => {
    const u1 = createTestUnit({ unitId: "u1", team: "a", x: 0, y: 0 });
    const u2 = createTestUnit({ unitId: "u2", team: "b", x: 5, y: 5, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard()] },
    });

    const [next, events] = applyCommand(battle, { type: "end_turn", actor: "u1" }, createTestRNG());

    expect(next.units["u2"].hp).toBe(20);
    expect(events.find((e) => e["type"] === "hazard_tick")).toBeUndefined();
  });

  it("does not consume RNG when map has no hazards (replay stability)", () => {
    // Maps without hazards should be unaffected by the hazard-tick feature.
    // Prove it by checking rng.callCount is identical to a baseline where
    // hazards never existed.
    const u1 = createTestUnit({ unitId: "u1", team: "a" });
    const u2 = createTestUnit({ unitId: "u2", team: "b", x: 2, y: 2 });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      // No hazards field at all.
    });

    const rng = createTestRNG();
    const before = rng.callCount;
    applyCommand(battle, { type: "end_turn", actor: "u1" }, rng);
    // end_turn with no effects and no hazards should consume zero RNG.
    expect(rng.callCount).toBe(before);
  });

  it("applies basic-save multiplier: crit fail doubles, crit success zeroes", () => {
    // Two runs with extreme reflex mods to force outcomes.
    const u1 = createTestUnit({ unitId: "u1", team: "a" });

    // Crit fail: reflex -20 vs DC 14 guarantees roll+mod misses DC by 10+.
    const loserU2 = createTestUnit({ unitId: "u2", team: "b", x: 2, y: 2, hp: 30, maxHp: 30, reflex: -20 });
    const loseBattle = createTestBattle({
      units: { u1, u2: loserU2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard({ damagePerTurn: 5 })] },
    });
    const [loseNext, loseEvents] = applyCommand(loseBattle, { type: "end_turn", actor: "u1" }, createTestRNG(42));
    const loseTick = loseEvents.find((e) => e["type"] === "hazard_tick")!;
    const loseDmg = (loseTick["payload"] as Record<string, unknown>)["damage"] as Record<string, unknown>;
    expect(loseDmg["multiplier"]).toBe(2.0);
    expect(loseNext.units["u2"].hp).toBe(30 - 10);

    // Crit success: reflex +40 vs DC 14 guarantees beat-by-10+.
    const winnerU2 = createTestUnit({ unitId: "u2", team: "b", x: 2, y: 2, hp: 30, maxHp: 30, reflex: 40 });
    const winBattle = createTestBattle({
      units: { u1, u2: winnerU2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard({ damagePerTurn: 5 })] },
    });
    const [winNext, winEvents] = applyCommand(winBattle, { type: "end_turn", actor: "u1" }, createTestRNG(42));
    const winTick = winEvents.find((e) => e["type"] === "hazard_tick")!;
    const winDmg = (winTick["payload"] as Record<string, unknown>)["damage"] as Record<string, unknown>;
    expect(winDmg["multiplier"]).toBe(0.0);
    expect(winNext.units["u2"].hp).toBe(30);
  });

  it("respects immunities", () => {
    const u1 = createTestUnit({ unitId: "u1", team: "a" });
    const u2 = createTestUnit({
      unitId: "u2", team: "b", x: 2, y: 2, hp: 20, maxHp: 20,
      reflex: -20, // force crit-fail → 2× damage, but then immunity nulls it
      immunities: ["fire"],
    });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard()] },
    });

    const [next, events] = applyCommand(battle, { type: "end_turn", actor: "u1" }, createTestRNG());

    expect(next.units["u2"].hp).toBe(20);
    const tick = events.find((e) => e["type"] === "hazard_tick")!;
    const dmg = (tick["payload"] as Record<string, unknown>)["damage"] as Record<string, unknown>;
    expect(dmg["immune"]).toBe(true);
    expect(dmg["applied_total"]).toBe(0);
  });

  it("applies unconscious when damage reduces HP to 0", () => {
    const u1 = createTestUnit({ unitId: "u1", team: "a" });
    const u2 = createTestUnit({
      unitId: "u2", team: "b", x: 2, y: 2, hp: 3, maxHp: 10,
      reflex: -20, // crit fail → 2×5 = 10 damage > 3 hp
    });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard()] },
    });

    const [next] = applyCommand(battle, { type: "end_turn", actor: "u1" }, createTestRNG());

    expect(next.units["u2"].hp).toBe(0);
    expect(next.units["u2"].conditions["unconscious"]).toBe(1);
  });

  it("ticks all zones covering the tile, stops on death", () => {
    // Two overlapping zones at (2,2). Second tick kills u2 — no third tick.
    const u1 = createTestUnit({ unitId: "u1", team: "a" });
    const u2 = createTestUnit({
      unitId: "u2", team: "b", x: 2, y: 2, hp: 7, maxHp: 10,
      reflex: -20, // crit fail → 2× each hit
    });
    const battle = createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: {
        width: 10, height: 10, blocked: [],
        hazards: [
          hazard({ id: "fire_a", damagePerTurn: 3 }), // 2× → 6, hp 7→1
          hazard({ id: "fire_b", damagePerTurn: 3 }), // 2× → 6, hp 1→0, unconscious
          hazard({ id: "fire_c", damagePerTurn: 3 }), // should NOT tick (dead)
        ],
      },
    });

    const [next, events] = applyCommand(battle, { type: "end_turn", actor: "u1" }, createTestRNG());

    const ticks = events.filter((e) => e["type"] === "hazard_tick");
    expect(ticks).toHaveLength(2);
    expect((ticks[0]["payload"] as Record<string, unknown>)["hazard_id"]).toBe("fire_a");
    expect((ticks[1]["payload"] as Record<string, unknown>)["hazard_id"]).toBe("fire_b");
    expect(next.units["u2"].hp).toBe(0);
  });

  it("is deterministic: same seed + same state → identical damage", () => {
    const u1 = createTestUnit({ unitId: "u1", team: "a" });
    const u2 = createTestUnit({ unitId: "u2", team: "b", x: 2, y: 2, hp: 20, maxHp: 20, reflex: 5 });
    const mkBattle = () => createTestBattle({
      units: { u1, u2 },
      turnOrder: ["u1", "u2"],
      battleMap: { width: 10, height: 10, blocked: [], hazards: [hazard()] },
    });

    const [a] = applyCommand(mkBattle(), { type: "end_turn", actor: "u1" }, new DeterministicRNG(777));
    const [b] = applyCommand(mkBattle(), { type: "end_turn", actor: "u1" }, new DeterministicRNG(777));

    expect(a.units["u2"].hp).toBe(b.units["u2"].hp);
  });
});
